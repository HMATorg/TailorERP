/**
 * UBL 2.1 invoice document for ZATCA Fatoora Phase 2.
 *
 * Hand-built rather than templated: the element ORDER is significant for
 * canonicalisation and hashing, so an XML builder that reorders attributes or
 * collapses whitespace would silently produce a different hash than ZATCA
 * computes. Keeping it explicit makes the ordering reviewable.
 */

export interface UblLine {
  id: number;
  name: string;
  quantity: number;
  unitCode: string;
  /** net unit price, 2dp string */
  unitPrice: string;
  /** net line total, 2dp string */
  lineNet: string;
  /** VAT for the line, 2dp string */
  lineVat: string;
  vatRate: string;
}

export interface UblInvoiceInput {
  invoiceNumber: string;
  uuid: string;
  /** ISO instant */
  issuedAt: Date;
  icv: number;
  previousHash: string;
  invoiceTypeCode: 'simplified' | 'standard';
  currency: string;
  seller: {
    name: string;
    vatNumber: string;
    address?: string | null;
  };
  buyer: {
    name: string;
    phone?: string | null;
    vatNumber?: string | null;
  };
  lines: UblLine[];
  totalNet: string;
  totalVat: string;
  totalGross: string;
  /** Amount already paid (deposit) — shown as prepaid on the document */
  prepaidAmount?: string;
}

const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** ZATCA invoice type code: 0100000 standard (B2B), 0200000 simplified (B2C). */
function typeCodeName(type: 'simplified' | 'standard'): string {
  return type === 'standard' ? '0100000' : '0200000';
}

export function buildUblInvoice(input: UblInvoiceInput): string {
  const issued = input.issuedAt.toISOString();
  const issueDate = issued.slice(0, 10);
  const issueTime = issued.slice(11, 19);

  const lines = input.lines
    .map(
      (line) => `  <cac:InvoiceLine>
    <cbc:ID>${line.id}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${esc(line.unitCode)}">${line.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${input.currency}">${line.lineNet}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${input.currency}">${line.lineVat}</cbc:TaxAmount>
      <cbc:RoundingAmount currencyID="${input.currency}">${(
        Number(line.lineNet) + Number(line.lineVat)
      ).toFixed(2)}</cbc:RoundingAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${esc(line.name)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${line.vatRate}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${input.currency}">${line.unitPrice}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${esc(input.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${input.uuid}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${typeCodeName(input.invoiceTypeCode)}">388</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${input.currency}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${input.currency}</cbc:TaxCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${input.icv}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${input.previousHash}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="CRN">${esc(input.seller.vatNumber)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(input.seller.address ?? 'N/A')}</cbc:StreetName>
        <cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(input.seller.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(input.seller.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      ${
        input.buyer.vatNumber
          ? `<cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(input.buyer.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>`
          : ''
      }
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(input.buyer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${input.currency}">${input.totalVat}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${input.currency}">${input.totalNet}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${input.currency}">${input.totalVat}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${input.lines[0]?.vatRate ?? '15.00'}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${input.currency}">${input.totalNet}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${input.currency}">${input.totalNet}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${input.currency}">${input.totalGross}</cbc:TaxInclusiveAmount>
    <cbc:PrepaidAmount currencyID="${input.currency}">${input.prepaidAmount ?? '0.00'}</cbc:PrepaidAmount>
    <cbc:PayableAmount currencyID="${input.currency}">${(
      Number(input.totalGross) - Number(input.prepaidAmount ?? 0)
    ).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>`;
}

/**
 * Canonicalisation before hashing. ZATCA specifies C14N plus removal of the
 * signature-related elements; for our unsigned Phase-2-ready document the
 * meaningful part is stable whitespace, so we normalise line endings and strip
 * trailing spaces rather than pretending to implement full XML-C14N.
 */
export function canonicalize(xml: string): string {
  return xml
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}
