---
name: replicar-libro
description: Replica la plantilla del Libro Fiscal (Fiori Elements V2, columnas dinamicas, totales, drilldown y PDF backend) para un nuevo libro, pais o cliente — por ejemplo el Libro de Ventas GT a partir del Libro de Compras GT. Usar cuando el usuario pida crear, clonar, adaptar o replicar el libro (compras, ventas) para otro tipo de impuesto, servicio OData, pais o cliente.
---

# Replicar el Libro Fiscal

La app es una plantilla. Lo especifico de cada libro vive SOLO en:

1. `webapp/manifest.json` → `sap.ui5/config/libroFiscal` (+ ID de app, servicio, entity set, inbound)
2. `webapp/annotations/annotation.xml`
3. `webapp/i18n/i18n.properties`
4. Archivos con el ID de la app y del servicio (yaml, Component.js, index.html, init.js, test, package.json)

**Nunca** modificar `webapp/ext/controller/TaxReportEnrichedListExtension.controller.js`
ni `webapp/ext/util/RowGrouper.js` para replicar. Si algo del nuevo libro no se puede
expresar con la configuracion, DETENERSE y explicarlo al usuario (es un cambio de plantilla,
se hace en la rama plantilla y se lleva a todos los libros).

La referencia completa de cada clave esta en `docs/replicar-libro.md`: leerla primero.

## Reglas de trabajo

- Responder en español, corto y un paso a la vez.
- No asumir nombres de campos ni servicios: si un dato falta, preguntarlo.
- No tocar `ui5-deploy.yaml` (lo configura el usuario con `npm run deploy-config`).
- No hacer deploy, commit ni push sin que el usuario lo pida.

## Paso 1 — Reunir los datos (preguntar lo que falte, en una sola tanda)

| Dato | Ejemplo Compras GT |
|---|---|
| Pais / cliente / libro | GT / MQA / Compras |
| Tipo de impuesto | `V` (compras) · `A` (ventas) |
| Servicio OData V2 del reporte (con `;v=N`) | `/sap/opu/odata/sap/YMQAF_SB_TAXRPT_ENRICH_V2;v=2/` |
| `$metadata` del servicio del reporte | pedir al usuario que lo guarde en `odata/<SERVICIO>.txt` |
| Entity set del reporte y de parametros | `TaxReportEnrichedSet` · `TablaParametros` |
| Servicio V2 del PDF, accion, entidad, propiedad media | `/sap/opu/odata/sap/YMQA13FISB002/` · `generarPdf` · `PdfStream` · `PdfData` |
| Nombre de archivo PDF por defecto | `libro de compras.pdf` |
| Cambios de campos (ej. Proveedor → Cliente, Nit del cliente) | ver §3 de la guia |
| Columnas visibles, su orden y etiquetas | `UI.LineItem` actual |
| Campos ocultos / permitidos en Configuracion | `columnasPermitidas` |
| Destinos del drilldown (si cambian) | 4 apps de asientos contables |
| Nuevo ID de app (namespace UI5) | `yatl01.reportecolumnasdinamicas` → p. ej. `yatl02.libroventasgt` |
| Semantic Object - Action | `TaxReport-display` → p. ej. `SalesTaxReport-display` |
| Titulo | `Libro de Ventas Guatemala` |

## Paso 2 — Analizar el `$metadata`

Del archivo en `odata/`:
- **Namespace**: `<Schema Namespace="...">`. Es el prefijo de TODOS los `Target` de `annotation.xml`.
- Confirmar que existen el entity set del reporte, el de parametros y los campos de la configuracion.
- Listar al usuario las diferencias de campos contra Compras GT (campos que no existen, nuevos, renombrados) y confirmar el mapeo antes de editar.

## Paso 3 — Aplicar cambios (en este orden)

1. **ID de la app**: reemplazar `yatl01.reportecolumnasdinamicas` y `yatl01/reportecolumnasdinamicas`
   en `manifest.json`, `Component.js`, `index.html`, `init.js`, `ui5.yaml`, `ui5-local.yaml`,
   `ui5-mock.yaml`, `webapp/test/**`; `name` en `package.json`.
2. **manifest.json**: `dataSources.mainService.uri`, entity set (en `extends` y en `pages`),
   `crossNavigation.inbounds`, y `sap.ui5/config/libroFiscal` completo.
3. **annotation.xml**: reemplazar el namespace en todos los `Target`; ajustar `UI.SelectionFields`,
   `UI.LineItem` (orden/etiquetas), `UI.HeaderInfo`, `UI.PresentationVariant`, value help de Sociedad
   y `Capabilities.FilterRestrictions` (periodo obligatorio, valor unico).
4. **i18n.properties**: `appTitle`, `reportTitle`, `summaryIvaColumn`, `summaryTotalColumn` y textos
   que cambien (Proveedor → Cliente, mensajes del PDF).
5. **CLAUDE.md** del proyecto: actualizar titulo, contexto (libro, pais, rama) y la lista de
   servicios OData de `odata/`.
6. **Mock**: copiar el `$metadata` real a `webapp/localService/mainService/metadata.xml`, ajustar
   `urlPath` del mockserver en `ui5-mock.yaml` y `ui5-local.yaml`, y revisar/borrar los JSON de
   `webapp/localService/mainService/data/` que ya no correspondan.

## Paso 4 — Validar

- `node --check` del controlador; JSON valido en `manifest.json`; XML bien formado en `annotation.xml`.
- `grep` del ID viejo, del namespace viejo y del servicio viejo: no debe quedar ninguno
  (salvo en `docs/` y `odata/`).
- Levantar el mock (`npx fiori run --config ./ui5-mock.yaml`). Si las librerias dan 404, usar una
  copia temporal del yaml con `version: "1.120.53"` en la seccion `ui5` y borrarla al terminar.
- Revisar en el navegador: filtros obligatorios con `*`, columnas C01..C15 con nombres de
  parametros, totales de pagina, Total por Tipo de Documento / Impuesto, "Volver al detalle",
  popover del drilldown y llamada del PDF (puede simularse interceptando `fetch`).
- `npx ui5 build --config=ui5.yaml --dest <carpeta temporal>`: debe terminar en "Build succeeded".

## Paso 5 — Entregar

Resumir al usuario:
- Archivos modificados y valores principales de la configuracion.
- Lo que NO se pudo probar (backend real, Launchpad, PDF real).
- Pendientes del backend (§4 de la guia): vista sin BDEF, filas en la tabla de parametros para el
  nuevo tipo de impuesto, BO del PDF con su Adobe Form y binding V2 propio.
- Pasos de deploy: `npm run deploy-config` (BSP, paquete, transporte) → `npm run deploy` →
  limpiar cache (SA38 `/UI2/INVALIDATE_GLOBAL_CACHES` + SMICM invalidar globalmente).
