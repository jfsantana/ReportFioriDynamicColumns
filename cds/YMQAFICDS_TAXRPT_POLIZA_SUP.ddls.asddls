@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Proveedor del pedido - polizas importacion'
@Metadata.ignorePropagatedAnnotations: true

define view entity YMQAFICDS_TAXRPT_POLIZA_SUP
  as select from    I_OperationalAcctgDocItem as W
    inner join      I_PurchaseOrderAPI01      as PO on W.PurchasingDocument = PO.PurchaseOrder
    left outer join I_BusinessPartner         as BP on PO.Supplier = BP.BusinessPartner
{
  key W.CompanyCode,
  key W.AccountingDocument,
  key W.FiscalYear,

      max( W.PurchasingDocument )      as PurchaseOrderPoliza,
      max( PO.Supplier )               as SupplierPoliza,
      max( BP.BusinessPartnerFullName ) as SupplierPolizaName
}
where
  W.AccountingDocumentItemType = 'W'
group by
  W.CompanyCode,
  W.AccountingDocument,
  W.FiscalYear
