export enum SalesDocumentType {
  QUOTE = 'QUOTE',
  SALES_ORDER = 'SALES_ORDER',
  INVOICE = 'INVOICE',
  SUPPLIER_RFQ = 'SUPPLIER_RFQ',
  PURCHASE_ORDER = 'PURCHASE_ORDER',
  GOODS_RECEIPT = 'GOODS_RECEIPT',
}

export enum TaxMode {
  EXCLUSIVE = 'EXCLUSIVE',
  INCLUSIVE = 'INCLUSIVE',
  EXEMPT = 'EXEMPT',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
}

export interface SalesLineCalculationInput {
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxMode: TaxMode;
  taxRate: string;
}

export interface SalesLineCalculationResult {
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
}
