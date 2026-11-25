# Replicar el Libro Fiscal (Compras / Ventas / otro país)

Esta app es una **plantilla**: el código (controlador, `RowGrouper`, CSS) es común
a todos los libros. Lo específico de cada libro vive en **cuatro lugares**:

| Archivo | Qué contiene |
|---|---|
| `webapp/manifest.json` → `sap.ui5/config/libroFiscal` | Tipo de impuesto, nombres de campos, filtros, anchos, drilldown, servicio del PDF |
| `webapp/manifest.json` (resto) | ID de la app, servicio OData, entity set, inbound del Launchpad |
| `webapp/annotations/annotation.xml` | Columnas, filtros, etiquetas, orden inicial, value helps |
| `webapp/i18n/i18n.properties` | Títulos y textos visibles |

**No se modifica** `webapp/ext/controller/TaxReportEnrichedListExtension.controller.js`
ni `webapp/ext/util/RowGrouper.js` al replicar.

---

## 1. Datos que hay que tener antes de empezar

| Dato | Ejemplo (Compras GT) |
|---|---|
| País / cliente / tipo de libro | GT / MQA / Compras |
| Tipo de impuesto | `V` (compras) · `A` (ventas) |
| Servicio OData V2 del reporte (con versión) | `/sap/opu/odata/sap/YMQAF_SB_TAXRPT_ENRICH_V2;v=2/` |
| Namespace del `$metadata` (`<Schema Namespace="...">`) | `cds_ymqaf_sb_taxrpt_enrich_v2` |
| Entity set del reporte | `TaxReportEnrichedSet` |
| Entity set de parámetros (columnas dinámicas) | `TablaParametros` |
| Servicio OData V2 del PDF + acción + entidad | `/sap/opu/odata/sap/YMQA13FISB002/` · `generarPdf` · `PdfStream` |
| Mapeo de campos principales (ver §3) | `Proveedor` → en ventas `Cliente`, etc. |
| Columnas visibles / ocultas / permitidas | ver `UI.LineItem` y `columnasPermitidas` |
| ID de la app (namespace UI5) | `yatl01.reportecolumnasdinamicas` |
| Nombre BSP, paquete y orden de transporte | `YATL01` · `YATL01` · `DM2K...` |
| Semantic Object - Action del Launchpad | `TaxReport-display` |

> Verifica el namespace abriendo `<servicio>/$metadata` en el navegador: si no coincide,
> **las anotaciones no se aplican** (la app sale sin columnas ni filtros).

---

## 2. Pasos

1. **Copiar** la plantilla (nuevo repositorio o rama desde `plantilla-libroCompra-fiscal`).
2. **ID de la app**: reemplazar `yatl01.reportecolumnasdinamicas` / `yatl01/reportecolumnasdinamicas`
   por el nuevo ID en: `manifest.json`, `Component.js`, `index.html`, `init.js`,
   `ui5.yaml`, `ui5-local.yaml`, `ui5-mock.yaml`, `webapp/test/**`, `package.json` (`name`).
3. **manifest.json**
   - `sap.app.dataSources.mainService.uri` → servicio del reporte (con `;v=N` si aplica).
   - Entity set del reporte en `sap.ui5.extends...sap.ui.generic.app` y en `sap.ui.generic.app.pages`.
   - `sap.app.crossNavigation.inbounds` → Semantic Object y Action del nuevo libro.
   - `sap.ui5/config/libroFiscal` → ver §3.
4. **annotation.xml**
   - Reemplazar el namespace en **todos** los `Target="..."` (buscar y reemplazar).
   - `UI.SelectionFields`, `UI.LineItem` (orden y etiquetas), `UI.HeaderInfo`,
     `UI.PresentationVariant` (orden inicial), value help de Sociedad.
   - `Capabilities.FilterRestrictions` → Período contable obligatorio y de valor único.
5. **i18n.properties**: `appTitle`, `reportTitle`, `summaryIvaColumn`, `summaryTotalColumn`
   y los textos que cambien (p. ej. "Proveedor" → "Cliente").
6. **Mock local**: `webapp/localService/mainService/metadata.xml` con el `$metadata` real del
   servicio nuevo, y `urlPath` del mockserver en `ui5-mock.yaml` / `ui5-local.yaml`.
7. **Deploy**: configurar `ui5-deploy.yaml` del **proyecto nuevo** (BSP, paquete, transporte)
   con `npm run deploy-config`. En el proyecto de Compras GT `ui5-deploy.yaml` no se toca.
8. **Probar** (§5) y **desplegar** (§6).

---

## 3. Referencia de `sap.ui5/config/libroFiscal`

| Clave | Para qué sirve |
|---|---|
| `tipoImpuesto` | Tipo fijo del libro (`V` compras, `A` ventas). Filtra `TablaParametros`. |
| `parametros.*` | Entity set y campos de la tabla de parámetros (sociedad, tipo, columna `Cnn`, descripción). |
| `filtros.sociedad / ejercicio / periodo` | Nombres de los filtros obligatorios (parámetros `P_...` y período). |
| `campos.sociedad / documento / ejercicio` | Identidad del documento (agrupado, drilldown, conteo de documentos). |
| `campos.tipoDocumento / descripcionTipoDocumento` | Total por Tipo de Documento. |
| `campos.indicadorImpuesto / nombreIndicadorImpuesto / posicionImpuesto` | Total por Tipo de Impuesto y columnas que desagrupan el detalle. |
| `campos.iva / total` | Columnas de importe fijas (además de C01..C99). |
| `campos.moneda` | Moneda que se oculta en las celdas de importe. |
| `camposFecha` | Fechas que se muestran como dd.mm.aaaa (tabla y filtros). |
| `columnaFija` | Columna que no se puede ocultar (p. ej. NO. DOCUMENTO). |
| `columnasPermitidas` | Campos que se ven o se pueden agregar desde Configuración; el resto se desactiva. |
| `anchoColumnas`, `anchoColumnasScroll`, `anchoColumnaScrollPorDefecto` | Anchos fijos y anchos con scroll horizontal. |
| `ordenInicial` | Orden de respaldo si la consulta no trae orden. |
| `drilldown.campo` | Columna que se convierte en link. |
| `drilldown.destinos[]` | `texto` (clave i18n) y `hash` del Launchpad; `{Campo}` se reemplaza por el valor de la fila. |
| `pdf.servicio / accion / entitySet / propiedadMedia` | Servicio OData V2 del PDF (FunctionImport + entidad stream). |
| `pdf.parametros` | Parámetro de la acción → `sociedad` / `ejercicio` / `periodo`. |
| `pdf.nombreArchivoPorDefecto` | Nombre si el backend no devuelve `FileName`. |

---

## 4. Backend (ABAP) por libro

- **Vista del reporte** con parámetros `P_CompanyCode` / `P_FiscalYear`: **sin Behavior Definition**
  (si no, el binding da *"Non-hidden view parameters are not allowed in transactional entity"*).
- **Tabla de parámetros** (`TablaParametros`) con filas para el nuevo tipo de impuesto.
- **PDF**: tabla de almacenamiento, CDS raíz del stream, entidad abstracta de parámetros,
  BDEF *managed* con `static action generarPdf`, clase de implementación con el Adobe Form
  del libro, y binding **OData V2** propio (no compartir service definition con el reporte).

---

## 5. Validación antes de desplegar

- [ ] `<servicio>/$metadata` abre y su namespace coincide con `annotation.xml`.
- [ ] La app carga con `npm run start-mock`: filtros obligatorios con `*`, columnas C01..C15
      con los nombres de `TablaParametros`, totales de página.
- [ ] Total por Tipo de Documento / Impuesto y "Volver al detalle".
- [ ] Link del drilldown abre el popover con los destinos.
- [ ] "Descargar PDF" llama a la acción con Sociedad, Ejercicio y Período.
- [ ] Sin errores `[TaxReport]` en la consola.

> Si el mock local no carga las librerías (404 en `/resources`), es la versión de UI5:
> el proxy pide la `minUI5Version` exacta (`1.120.0`). Fijar `version: "1.120.53"` en la
> sección `ui5` del yaml de pruebas.

---

## 6. Después del deploy (caché del servidor)

Si el Launchpad sigue mostrando la versión anterior:

1. Verificar el archivo directo: `/sap/bc/ui5_ui5/sap/<bsp>/manifest.json?sap-client=<mandante>`.
2. **SA38** → `/UI2/INVALIDATE_GLOBAL_CACHES` → marcar "Modo de ejecución" → F8.
3. **SMICM** → Pasar a → Plug-in HTTP → Caché servidor → **Invalidar globalmente** → Sí.
4. Cerrar todas las ventanas de incógnito y abrir de nuevo.
