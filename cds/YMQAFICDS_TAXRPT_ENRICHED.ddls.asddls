@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'S2 Tax Report PIVOT por Grupo Config'
@Metadata.ignorePropagatedAnnotations: true

define root view entity YMQAFICDS_TAXRPT_ENRICHED
  with parameters
    P_CompanyCode : bukrs,
    P_FiscalYear  : gjahr

  as select from YMQAFICDS_TAXRPT_PRINCIPAL(
      P_CompanyCode: $parameters.P_CompanyCode,
      P_FiscalYear:  $parameters.P_FiscalYear ) as CDS1

  left outer join ymqatb_tax_cfg as CFG1
    on  CDS1.CompanyCode = CFG1.sociedad
    and CDS1.TaxCode     = CFG1.taxco
    and CFG1.field_name  = 'C01'
    and CFG1.tax_type    = 'V'

  left outer join ymqatb_tax_cfg as CFG2
    on  CDS1.CompanyCode = CFG2.sociedad
    and CDS1.TaxCode     = CFG2.taxco
    and CFG2.field_name  = 'C02'
    and CFG2.tax_type    = 'V'

  left outer join ymqatb_tax_cfg as CFG3
    on  CDS1.CompanyCode = CFG3.sociedad
    and CDS1.TaxCode     = CFG3.taxco
    and CFG3.field_name  = 'C03'
    and CFG3.tax_type    = 'V'

  left outer join ymqatb_tax_cfg as CFG4
    on  CDS1.CompanyCode = CFG4.sociedad
    and CDS1.TaxCode     = CFG4.taxco
    and CFG4.field_name  = 'C04'
    and CFG4.tax_type    = 'V'

  left outer join ymqatb_tax_cfg as CFG5
    on  CDS1.CompanyCode = CFG5.sociedad
    and CDS1.TaxCode     = CFG5.taxco
    and CFG5.field_name  = 'C05'
    and CFG5.tax_type    = 'V'

  left outer join ymqatb_tax_cfg as CFG6
    on  CDS1.CompanyCode = CFG6.sociedad
    and CDS1.TaxCode     = CFG6.taxco
    and CFG6.field_name  = 'C06'
    and CFG6.tax_type    = 'V'

  left outer join ymqatb_tax_cfg as CFG7
    on  CDS1.CompanyCode = CFG7.sociedad
    and CDS1.TaxCode     = CFG7.taxco
    and CFG7.field_name  = 'C07'
    and CFG7.tax_type    = 'V'

  left outer join ymqatb_tax_cfg as CFG8
    on  CDS1.CompanyCode = CFG8.sociedad
    and CDS1.TaxCode     = CFG8.taxco
    and CFG8.field_name  = 'C08'
    and CFG8.tax_type    = 'V'

  left outer join ymqatb_tax_cfg as CFG9
    on  CDS1.CompanyCode = CFG9.sociedad
    and CDS1.TaxCode     = CFG9.taxco
    and CFG9.field_name  = 'C09'
    and CFG9.tax_type    = 'V'

  left outer join ymqatb_tax_cfg as CFG10
    on  CDS1.CompanyCode = CFG10.sociedad
    and CDS1.TaxCode     = CFG10.taxco
    and CFG10.field_name  = 'C10'
    and CFG10.tax_type    = 'V'

  left outer join ymqatb_tax_cfg as CFG11
    on  CDS1.CompanyCode = CFG11.sociedad
    and CDS1.TaxCode     = CFG11.taxco
    and CFG11.field_name  = 'C11'
    and CFG11.tax_type    = 'V'

  left outer join ymqatb_tax_cfg as CFG12
    on  CDS1.CompanyCode = CFG12.sociedad
    and CDS1.TaxCode     = CFG12.taxco
    and CFG12.field_name  = 'C12'
    and CFG12.tax_type    = 'V'

  left outer join ymqatb_tax_cfg as CFG13
    on  CDS1.CompanyCode = CFG13.sociedad
    and CDS1.TaxCode     = CFG13.taxco
    and CFG13.field_name  = 'C13'
    and CFG13.tax_type    = 'V'

  left outer join ymqatb_tax_cfg as CFG14
    on  CDS1.CompanyCode = CFG14.sociedad
    and CDS1.TaxCode     = CFG14.taxco
    and CFG14.field_name  = 'C14'
    and CFG14.tax_type    = 'V'

  left outer join ymqatb_tax_cfg as CFG15
    on  CDS1.CompanyCode = CFG15.sociedad
    and CDS1.TaxCode     = CFG15.taxco
    and CFG15.field_name  = 'C15'
    and CFG15.tax_type    = 'V'

{
  key CDS1.CompanyCode,
  key CDS1.AccountingDocument,                       // 16 No. documento
  key CDS1.FiscalYear,

      //═══════════════════════════════════════
      // DATOS DEL DOCUMENTO (libro de compras)
      //═══════════════════════════════════════
      CDS1.PostingDate,                              // orden cronologico
      CDS1.FiscalPeriod,
      CDS1.DocumentDate,
      CDS1.DocumentDateFormatted,                    // 2  Dia
      @Consumption.valueHelpDefinition: [{ entity: { name: 'I_AccountingDocumentType',
                                                     element: 'AccountingDocumentType' } }]
      CDS1.AccountingDocumentType,
      CDS1.TipDocSat,                                // 3  Tipo de documento
      CDS1.DescTipoDocumento,                        // 4  Desc. tipo de documento
      CDS1.Serie,                                    // 4  Serie
      CDS1.DocumentReferenceID,                      // 6  No. documento
      CDS1.Nit,                                      // 7  NIT
      CDS1.Proveedor,                                // 8  Proveedor
      CDS1.NoProveedor,                              // 15 No. proveedor
      @Consumption.valueHelpDefinition: [{ entity: { name: 'I_Supplier',
                                                     element: 'Supplier' } }]
      CDS1.Supplier,
      CDS1.TrataEspecialPoliza,
      CDS1.SupplierPoliza,
      CDS1.TaxCodeName,
      CDS1.TaxCode,

      CDS1.CompanyCodeCurrency,
      CDS1.TransactionCurrency,

      //═══════════════════════════════════════
      // MONTOS PIVOT: base imponible por columna (Tabla 1)
      //═══════════════════════════════════════
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG1.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C01,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG2.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C02,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG3.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C03,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG4.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C04,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG5.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C05,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG6.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C06,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG7.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C07,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG8.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C08,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG9.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C09,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG10.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C10,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG11.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C11,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG12.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C12,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG13.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C13,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG14.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C14,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when CFG15.taxco is not null
                then cast( CDS1.TaxBaseAmountInCoCodeCrcy as abap.curr(23,2) )
                else cast( 0                              as abap.curr(23,2) )
           end ) as C15,

      //═══════════════════════════════════════
      // IVA / TOTAL / CANTIDAD
      //═══════════════════════════════════════
      @EndUserText.label: 'IVA'
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( cast( CDS1.ImporteIVA as abap.curr(23,2) ) )  as ImporteIVA,       // 13

      @EndUserText.label: 'Total'
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( cast( CDS1.Total as abap.curr(23,2) ) )       as Total,            // 14

      @EndUserText.label: 'Cantidad'
      count( distinct CDS1.AccountingDocument )          as Cantidad

}
group by
  CDS1.CompanyCode,
  CDS1.AccountingDocument,
  CDS1.FiscalYear,
  CDS1.PostingDate,
  CDS1.FiscalPeriod,
  CDS1.DocumentDate,
  CDS1.DocumentDateFormatted,
  CDS1.AccountingDocumentType,
  CDS1.TipDocSat,
  CDS1.DescTipoDocumento,
  CDS1.Serie,
  CDS1.DocumentReferenceID,
  CDS1.Nit,
  CDS1.Proveedor,
  CDS1.NoProveedor,
  CDS1.Supplier,
  CDS1.TrataEspecialPoliza,
  CDS1.SupplierPoliza,
  CDS1.CompanyCodeCurrency,
  CDS1.TransactionCurrency,
  CDS1.TaxCodeName,
  CDS1.TaxCode
