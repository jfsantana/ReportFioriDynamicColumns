# Requerimiento: Libro de Compras

## Objetivo
El objetivo es desarrollar el reporte del Libro de Compras y Servicios para cumplir con las exigencias normativas de la SAT de Guatemala. Este desarrollo permitirá a las empresas contribuyentes llevar un registro cronológico y detallado de sus adquisiciones, controlando así el crédito fiscal del IVA y sustentando sus declaraciones mensuales.
la compolejidad del rorte e sqyue los campos del reporte final tiene que ser dinamicos dependiedno del cmapo taxCode que esta en el reporte original (libro de compas que esta en el odata YMQA13FISB002)

## Servicios OData
- YMQA13FISB002: (Libro de compras para reportes mas adelante. Aquí se expone 2 entity una de ellas es I_CompanyCode el cual puedes sacar la denominacion de la sociedad y otros campos más. en la ruta reporte_columnas_dinamicas\odata\YMQA13FISB002.txt esta el detalle de las entidades y el metadata )
- YMQA13FISB003: (Tabla de clase de impuesto aqui nos inetreesa la entidad i_taxType que nos permite filtrara los registros que vamso a trabajar ya que UNICAMENTE usaremos los tipo V o Input Tax)
- YMQA13FISB005: (Tabla Documentos SAT. este servicio nos permitira agrupar los los regsiyros para reportes subsiguientes)

- MQAF_SB_TAXRPT_ENRICH_V2: (ESTE ES EL ODATA PRINCIPAL de aqui nos interes ala entidad de TablaParametros ya que aqui es dodne estan los nombres de los campos que vamos a usar)

- Cómo se relacionan entre sí: actualmente el apps esta funcionando solo que ahro ase ajusto el datasourse MQAF_SB_TAXRPT_ENRICH_V2 con la data ya definitiva.  lo que quiero actualmenet es validar que el reporte funcione para ir adicionando mas elementos

## Filtros
| Filtro | Obligatorio |
|Company Code|Fiscal Year|

## Columnas del reporte
actualmenet queiro que se muetsre con todas las columnas que se armen de fomra dinamica que sean tipo Impuetso V
## Reglas de negocio
- solamente se travbajara con tipo Impuetso = V

## Exportación
- Exportar a PDF usando unformato personalizado para el reporte

## Qué se reutiliza del prototipo
- todo el prototipo esta operativo necesito que quede igual funcional antes de mejorarlo


## Pendientes o dudas
- este reporte ira adicionando mas requeriemintos pero ahroa neceiosto activarlo
