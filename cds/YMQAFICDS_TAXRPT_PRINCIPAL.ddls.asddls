@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'CDS informacion reportes fiscales'
@Metadata.ignorePropagatedAnnotations: true
@Metadata.allowExtensions: true

define view entity YMQAFICDS_TAXRPT_PRINCIPAL
  with parameters
    P_CompanyCode : bukrs,
    P_FiscalYear  : gjahr

  as select from YMQAFICDS_TAXRPT_L3_PRINCIPAL( P_CompanyCode: $parameters.P_CompanyCode, P_FiscalYear: $parameters.P_FiscalYear ) as L3

  association [0..1] to I_BusinessPartner          as _BusinessPartner on  L3.BusinessPartner = _BusinessPartner.BusinessPartner
  association [0..1] to I_Businesspartnertaxnumber as _BPTaxNumber     on  L3.BusinessPartner = _BPTaxNumber.BusinessPartner

  // Tabla 3 - Tipo de documento SAT (todas las clases de documento, IVA soportado)
  association [0..1] to ymqa13fitb003              as _TipoDocSat      on  L3.AccountingDocumentType = _TipoDocSat.clase_doc
                                                                       and _TipoDocSat.tax_type      = 'V'

  // Tabla 1/2 - Indicador de IVA -> grupo/columna del libro (01..04)
  association [0..1] to YMQAFICDS_TAX_PARAMS       as _TaxParams       on  L3.CompanyCode    = _TaxParams.Sociedad
                                                                       and L3.TaxCode        = _TaxParams.Taxc
                                                                       and _TaxParams.TaxType = 'V'

  association [0..1] to I_OperationalAcctgDocItem  as _PODocItem       on  L3.CompanyCode        = _PODocItem.CompanyCode
                                                                       and L3.AccountingDocument = _PODocItem.AccountingDocument
                                                                       and L3.FiscalYear         = _PODocItem.FiscalYear
                                                                       and _PODocItem.AccountingDocumentItemType = 'W'

  // Proveedor del pedido de compras (1 registro por documento)
  association [0..1] to YMQAFICDS_TAXRPT_POLIZA_SUP as _Poliza         on  L3.CompanyCode        = _Poliza.CompanyCode
                                                                       and L3.AccountingDocument = _Poliza.AccountingDocument
                                                                       and L3.FiscalYear         = _Poliza.FiscalYear

{
  key L3.CompanyCode,                                                              //1  Sociedad
  key L3.AccountingDocument,                                                       //2  N. documento FI
  key L3.FiscalYear,                                                               //3  Ejercicio
  key L3.TaxItem,                                                                  //4  Pos.impuestos

      L3.ReportingCountry,                                                         //5
      L3.TaxCalculationProcedure,                                                  //6
      L3.TaxCode,                                                                  //7
      L3.TaxCodeName,                                                              //8

      @EndUserText.label: 'Clase de impuesto'
      cast( upper( _TaxParams.DescripcionGrup ) as abap.char(30) )                as ClaseImpuesto,

      L3.CompanyCodeCurrency,
      L3.TransactionCurrency,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      L3.TaxBaseAmountInCoCodeCrcy,                                                //9
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      L3.TaxAmountInCoCodeCrcy,                                                    //10
      @Semantics.amount.currencyCode: 'TransactionCurrency'
      L3.TaxBaseAmountInTransCrcy,                                                 //12
      @Semantics.amount.currencyCode: 'TransactionCurrency'
      L3.TaxAmountInTransCrcy,                                                     //13

      L3.TransactionTypeDetermination,                                            //14
      L3.TaxDataSource,
      L3.DebitCreditCode,                                                         //17

      L3.OriginalReferenceDocument,                                               //18
      L3.ReferenceDocumentType,                                                   //19
      L3.PostingDate,                                                             //20
      L3.DocumentDate,                                                            //21

      @EndUserText.label: 'Dia'
      concat( concat( concat( concat(
        substring( cast( L3.DocumentDate as abap.char(8) ), 7, 2 ), '.' ),
        substring( cast( L3.DocumentDate as abap.char(8) ), 5, 2 ) ), '.' ),
        substring( cast( L3.DocumentDate as abap.char(8) ), 1, 4 ) )             as DocumentDateFormatted,

      L3.FiscalPeriod,                                                            //22
      L3.AccountingDocumentType,                                                  //23

      @EndUserText.label: 'Tipo de documento'
      _TipoDocSat.tip_doc_sat                                                     as TipDocSat,
      @EndUserText.label: 'Desc. tipo de documento'
      cast( upper( _TipoDocSat.descripcion ) as abap.char(40) )                   as DescTipoDocumento,

      @EndUserText.label: 'Serie'
      // TODO Instruccion 2: si ReferenceDocumentType = 'CAJO' tomar CashJournalDocumentText2 (no existe en L3)
      cast( upper( L3.AccountingDocumentHeaderText ) as abap.char(30) )          as Serie,

      L3.DocumentReferenceID,                                                     //24
      L3.AccountingDocumentHeaderText,                                            //25
      L3.TransactionCode,                                                         //26
      L3.AbsoluteExchangeRate,                                                    //28
      L3.ExchRateIsIndirectQuotation,
      L3.ExchangeRateDate,                                                        //29
      L3.AccountingDocCreatedByUser,                                              //30
      L3.ReversalReferenceDocument,                                               //31

      L3.FinancialAccountType,                                                    //32
      L3.Customer,                                                                //33
      L3.CustomerIsOneTimeAccount            as CustomerIsOneTimeAccount_D,       //34
      L3.Supplier,                                                                //35
      L3.SupplierIsOneTimeAccount            as SupplierIsOneTimeAccount_K,       //36
      L3.BusinessPartner,                                                         //37

      @EndUserText.label: 'NIT'
      // TODO Instr. 3/4 (doc sin BP / libro caja): AssignmentReference y CashJournalDocumentText1 no existen en L3
      cast( upper(
        case
          when L3.SupplierIsOneTimeAccount = 'X' and L3.SupplierOneTimeTaxID1 <> ''
            then cast( L3.SupplierOneTimeTaxID1 as abap.char(100) )
          when L3.SupplierIsOneTimeAccount = 'X'
            then cast( L3.SupplierOneTimeTaxID2 as abap.char(100) )
          when _BPTaxNumber.BPTaxNumber <> ''
            then cast( _BPTaxNumber.BPTaxNumber as abap.char(100) )
          else cast( _BPTaxNumber.BPTaxLongNumber as abap.char(100) )
        end ) as abap.char(100) )                                                 as Nit,

      @EndUserText.label: 'Proveedor'
      // TODO Instr. 3/4 (doc sin BP / libro caja): Reference3IDByBusinessPartner y ReceiptRecipientName no existen en L3
      cast( upper(
        case
          when L3.ReferenceDocumentType = 'RMRP' and _TipoDocSat.importacion = 'X'
            then cast( _Poliza.SupplierPolizaName as abap.char(160) )
          when L3.SupplierIsOneTimeAccount = 'X'
            then cast( concat_with_space( concat_with_space( concat_with_space(
                   L3.SupplierOneTimeName1, L3.SupplierOneTimeName2, 1 ),
                   L3.SupplierOneTimeName3, 1 ),
                   L3.SupplierOneTimeName4, 1 ) as abap.char(160) )
          else cast( _BusinessPartner.BusinessPartnerFullName as abap.char(160) )
        end ) as abap.char(160) )                                                 as Proveedor,

      @EndUserText.label: 'No. proveedor'
      case
        when L3.BusinessPartner <> '' then L3.BusinessPartner
        when L3.Supplier        <> '' then L3.Supplier
        else L3.Customer
      end                                                                         as NoProveedor,

      _BusinessPartner.BusinessPartnerFullName,                                   //38
      _BusinessPartner.OrganizationBPName1,                                       //39
      _BusinessPartner.OrganizationBPName2,                                       //40
      _BusinessPartner.OrganizationBPName3,                                       //41
      _BusinessPartner.OrganizationBPName4,                                       //42
      _BusinessPartner.FirstName,                                                 //43
      _BusinessPartner.LastName,                                                  //44
      _BusinessPartner.PersonFullName,                                            //45

      _BPTaxNumber.BPTaxType,                                                     //46
      _BPTaxNumber.BPTaxNumber,                                                   //47
      _BPTaxNumber.BPTaxLongNumber,                                               //48

      L3.SupplierOneTimeName1                as SupplierOneTimeName1_K,          //49
      L3.SupplierOneTimeName2                as SupplierOneTimeName2_K,          //50
      L3.SupplierOneTimeName3                as SupplierOneTimeName3_K,          //51
      L3.SupplierOneTimeName4                as SupplierOneTimeName4_K,          //52
      L3.SupplierOneTimeTaxID1               as SupplierOneTimeTaxID1_K,         //53
      L3.SupplierOneTimeTaxID2               as SupplierOneTimeTaxID2_K,         //54
      L3.SupplierOneTimeTaxID3               as SupplierOneTimeTaxID3_K,         //55

      L3.CustomerOneTimeName1                as CustomerOneTimeName1_D,          //56
      L3.CustomerOneTimeName2                as CustomerOneTimeName2_D,          //57
      L3.CustomerOneTimeName3                as CustomerOneTimeName3_D,          //58
      L3.CustomerOneTimeName4                as CustomerOneTimeName4_D,          //59
      L3.CustomerOneTimeTaxID1               as CustomerOneTimeTaxID1_D,         //60
      L3.CustomerOneTimeTaxID2               as CustomerOneTimeTaxID2_D,         //61
      L3.CustomerOneTimeTaxID3               as CustomerOneTimeTaxID3_D,         //62

      @EndUserText.label: 'Trata especial poliza'
      cast( case when L3.ReferenceDocumentType = 'RMRP' and _TipoDocSat.importacion = 'X'
                 then 'X' else ' ' end as abap_boolean preserving type )          as TrataEspecialPoliza,             //72

      @EndUserText.label: 'Pedido poliza importacion'
      _PODocItem.PurchasingDocument                                              as PurchaseOrderPoliza,              //73

      @EndUserText.label: 'Proveedor poliza'
      _Poliza.SupplierPoliza                                                     as SupplierPoliza,

      // ---------- Columnas de importe del libro (Tabla 1: grupos 01..04) ----------
      @EndUserText.label: 'Compra de bienes locales'
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      @Aggregation.default: #SUM
      case when _TaxParams.Grup = '01' then L3.TaxBaseAmountInCoCodeCrcy end    as ComprasBienesLocales,

      @EndUserText.label: 'Servicios recibidos locales'
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      @Aggregation.default: #SUM
      case when _TaxParams.Grup = '02' then L3.TaxBaseAmountInCoCodeCrcy end    as ServiciosRecibidosLocales,

      @EndUserText.label: 'Importaciones'
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      @Aggregation.default: #SUM
      case when _TaxParams.Grup = '03' then L3.TaxBaseAmountInCoCodeCrcy end    as Importaciones,

      @EndUserText.label: 'Compras exentas/no sujetas'
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      @Aggregation.default: #SUM
      case when _TaxParams.Grup = '04' then L3.TaxBaseAmountInCoCodeCrcy end    as ComprasExentasNoSujetas,

      @EndUserText.label: 'IVA'
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      @Aggregation.default: #SUM
      L3.TaxAmountInCoCodeCrcy                                                   as ImporteIVA,

      @EndUserText.label: 'Total'
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      @Aggregation.default: #SUM
      case when _TaxParams.Grup between '01' and '04'
           then L3.TaxBaseAmountInCoCodeCrcy + L3.TaxAmountInCoCodeCrcy
           else L3.TaxAmountInCoCodeCrcy
      end                                                                        as Total,

      @EndUserText.label: 'Cantidad'
      @Aggregation.default: #SUM
      cast( 1 as abap.int4 )                                                     as Cantidad
}
where
  L3.ReversalReferenceDocument = ''   // Doc. funcional: no incluir documentos anulados
