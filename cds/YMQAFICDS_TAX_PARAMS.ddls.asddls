@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Vista de parámetros para reporte Tax'
@Metadata.ignorePropagatedAnnotations: true
@Metadata.allowExtensions: true

define root view entity YMQAFICDS_TAX_PARAMS
  as select from ymqatb_tax_cfg

  association [0..1] to I_TaxType    as _TaxType    on $projection.TaxType = _TaxType.TaxType
  association [0..1] to I_CompanyCode as _CompanyCode on $projection.Sociedad = _CompanyCode.CompanyCode

{
    @ObjectModel.foreignKey.association: '_CompanyCode'
    @Consumption.valueHelpDefinition: [ { entity: { name: 'I_CompanyCode', element: 'CompanyCode' } } ]
    key sociedad          as Sociedad,

    key taxco             as Taxc,
    key grupo             as Grup,
        descripcion_grupo as DescripcionGrup,
        field_name        as FieldName,

        @ObjectModel.foreignKey.association: '_TaxType'
        @Consumption.valueHelpDefinition: [ { entity: { name: 'I_TaxType', element: 'TaxType' } } ]
        tax_type           as TaxType,

        _TaxType,
        _CompanyCode
}
