import { sign as ecdsaSign } from 'crypto';
import { readCertFacts } from './zatca-cert';
import { hashInvoiceXml } from './zatca-hash';
import { buildQrBase64, type ZatcaQrFields } from './zatca-tlv';
import { canonicalize } from './zatca-xml';

/**
 * XAdES-BES signing pipeline (ZATCA Detailed Technical Guideline §5) — D-057.
 *
 * Follows the guideline's six steps exactly, including its XPaths, so this
 * file is reviewable line-by-line against the spec rather than trusted on
 * faith:
 *   1. Invoice hash — done by the caller (`hashInvoiceXml(canonicalize(baseXml))`)
 *      before this runs, since it's also the value chained into the *next*
 *      invoice's PIH; this module takes it as an input rather than recomputing.
 *   2. ECDSA-sign the canonical invoice content with the private key.
 *   3. Hash the certificate.
 *   4. Populate SignedProperties (cert digest, signing time, issuer, serial).
 *   5. Hash the (canonicalised) SignedProperties block.
 *   6. Populate the final UBLExtensions: SignatureValue, X509Certificate, and
 *      the two Reference DigestValues (invoice data + SignedProperties).
 *
 * One documented ambiguity: the guideline's Step 2 says to sign "the
 * generated invoice hash... (not encode)", which could mean either (a) sign
 * the canonical XML content with an ECDSA-SHA256 operation — the standard
 * XML-DSig meaning of "ecdsa-with-SHA256", where the hash is computed
 * *inside* the signing step — or (b) treat the already-computed 32-byte
 * digest as an opaque message and sign those exact bytes without hashing
 * them again. This implements (a), since it matches how every other XML-DSig/
 * XAdES signer in existence interprets "ECDSA signature… of the hash" (the
 * digest is what a `<ds:Reference>` verifies independently, not what gets
 * fed to the signing primitive), and because double-hashing would make the
 * signature unverifiable by any standard XML-DSig verifier. If real
 * onboarding against ZATCA's sandbox shows signature rejection, this is the
 * first thing to try flipping — see `signCanonicalInvoice` below.
 */

const XADES_NS = 'http://uri.etsi.org/01903/v1.3.2#';
const DS_NS = 'http://www.w3.org/2000/09/xmldsig#';
const SIGNED_PROPERTIES_ID = 'xadesSignedProperties';
const SIGNATURE_ID = 'signature';

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface XadesSignInput {
  /** Base invoice XML from `buildUblInvoice()` — no UBLExtensions/QR/Signature yet. */
  baseXml: string;
  /** base64 SHA-256 of `canonicalize(baseXml)` — Section 5 Step 1's output; QR tag 6. */
  invoiceHash: string;
  /** PEM CSID certificate. */
  certificatePem: string;
  /** PEM EC private key matching the certificate. */
  privateKeyPem: string;
  signingTime?: Date;
  /** Whether to include QR tag 9 (the CA's signature over the CSID) — simplified (B2C) invoices only. */
  isSimplified: boolean;
  qr: Omit<ZatcaQrFields, 'invoiceHash' | 'signature' | 'publicKey' | 'stampSignature'>;
}

export interface XadesSignResult {
  /** Complete, submittable invoice XML — UBLExtensions signature block and the QR AdditionalDocumentReference spliced in. */
  signedXml: string;
  /** base64 TLV QR payload, all applicable tags. */
  qrCodeBase64: string;
  signatureBase64: string;
  publicKeyBase64: string;
  stampSignatureBase64?: string;
}

/** Step 2 in isolation, exposed separately so its interpretation is easy to swap without touching the rest of the pipeline. */
export function signCanonicalInvoice(canonicalXml: string, privateKeyPem: string): string {
  return ecdsaSign('sha256', Buffer.from(canonicalXml, 'utf8'), {
    key: privateKeyPem,
    dsaEncoding: 'der',
  }).toString('base64');
}

function buildSignedPropertiesXml(params: {
  certDigestBase64: string;
  signingTime: string;
  issuerName: string;
  serialNumberDecimal: string;
}): string {
  // Namespaces declared locally rather than inherited: canonicalising this
  // block in isolation (see the module doc) is only equivalent to
  // canonicalising it in place if the exact same namespace set is in scope
  // either way — declaring them here makes that true by construction, and
  // costs nothing when the block is re-embedded (redundant xmlns declarations
  // are valid, unambiguous XML).
  return (
    `<xades:SignedProperties xmlns:xades="${XADES_NS}" xmlns:ds="${DS_NS}" Id="${SIGNED_PROPERTIES_ID}">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${params.signingTime}</xades:SigningTime>` +
    `<xades:SigningCertificate><xades:Cert>` +
    `<xades:CertDigest>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
    `<ds:DigestValue>${params.certDigestBase64}</ds:DigestValue>` +
    `</xades:CertDigest>` +
    `<xades:IssuerSerial>` +
    `<ds:X509IssuerName>${esc(params.issuerName)}</ds:X509IssuerName>` +
    `<ds:X509SerialNumber>${params.serialNumberDecimal}</ds:X509SerialNumber>` +
    `</xades:IssuerSerial>` +
    `</xades:Cert></xades:SigningCertificate>` +
    `</xades:SignedSignatureProperties>` +
    `</xades:SignedProperties>`
  );
}

function buildUblExtensions(params: {
  invoiceHashBase64: string;
  signedPropertiesHashBase64: string;
  signatureValueBase64: string;
  certificateDerBase64: string;
  signedPropertiesXml: string;
}): string {
  return (
    `<ext:UBLExtensions>` +
    `<ext:UBLExtension>` +
    `<ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>` +
    `<ext:ExtensionContent>` +
    `<sig:UBLDocumentSignatures ` +
    `xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" ` +
    `xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" ` +
    `xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">` +
    `<sac:SignatureInformation>` +
    `<cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>` +
    `<sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>` +
    `<ds:Signature xmlns:ds="${DS_NS}" Id="${SIGNATURE_ID}">` +
    `<ds:SignedInfo>` +
    `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>` +
    `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>` +
    `<ds:Reference Id="invoiceSignedData" URI="">` +
    `<ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
    `<ds:DigestValue>${params.invoiceHashBase64}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#${SIGNED_PROPERTIES_ID}">` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
    `<ds:DigestValue>${params.signedPropertiesHashBase64}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>` +
    `<ds:SignatureValue>${params.signatureValueBase64}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${params.certificateDerBase64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `<ds:Object><xades:QualifyingProperties xmlns:xades="${XADES_NS}" Target="#${SIGNATURE_ID}">` +
    params.signedPropertiesXml +
    `</xades:QualifyingProperties></ds:Object>` +
    `</ds:Signature>` +
    `</sac:SignatureInformation>` +
    `</sig:UBLDocumentSignatures>` +
    `</ext:ExtensionContent>` +
    `</ext:UBLExtension>` +
    `</ext:UBLExtensions>`
  );
}

/** Splices a block in as the *first* child of the root element — required for UBLExtensions by the UBL 2.1 schema. */
function spliceAfterRootOpenTag(xml: string, block: string): string {
  const match = xml.match(/<Invoice\b[^>]*>/);
  if (!match || match.index == null) {
    throw new Error('Could not find the <Invoice> root element to splice the signature into');
  }
  const insertAt = match.index + match[0].length;
  return xml.slice(0, insertAt) + block + xml.slice(insertAt);
}

function buildQrAdditionalDocumentReference(qrBase64: string): string {
  return (
    `<cac:AdditionalDocumentReference>` +
    `<cbc:ID>QR</cbc:ID>` +
    `<cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qrBase64}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>` +
    `</cac:AdditionalDocumentReference>`
  );
}

export function signInvoiceXml(input: XadesSignInput): XadesSignResult {
  const cert = readCertFacts(input.certificatePem);
  const signingTime = (input.signingTime ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');

  // Step 2
  const signatureValueBase64 = signCanonicalInvoice(canonicalize(input.baseXml), input.privateKeyPem);

  // Step 4
  const signedPropertiesXml = buildSignedPropertiesXml({
    certDigestBase64: cert.certificateHashBase64,
    signingTime,
    issuerName: cert.issuerName,
    serialNumberDecimal: cert.serialNumberDecimal,
  });

  // Step 5
  const signedPropertiesHashBase64 = hashInvoiceXml(canonicalize(signedPropertiesXml));

  // Step 6
  const ublExtensions = buildUblExtensions({
    invoiceHashBase64: input.invoiceHash,
    signedPropertiesHashBase64,
    signatureValueBase64,
    certificateDerBase64: cert.certificateDerBase64,
    signedPropertiesXml,
  });

  const qrCodeBase64 = buildQrBase64({
    ...input.qr,
    invoiceHash: input.invoiceHash,
    signature: signatureValueBase64,
    publicKey: cert.publicKeySpkiBase64,
    stampSignature: input.isSimplified ? cert.caSignatureBase64 : undefined,
  });

  const withSignature = spliceAfterRootOpenTag(input.baseXml, ublExtensions);
  const signedXml = spliceAfterRootOpenTag(withSignature, buildQrAdditionalDocumentReference(qrCodeBase64));

  return {
    signedXml,
    qrCodeBase64,
    signatureBase64: signatureValueBase64,
    publicKeyBase64: cert.publicKeySpkiBase64,
    stampSignatureBase64: input.isSimplified ? cert.caSignatureBase64 : undefined,
  };
}
