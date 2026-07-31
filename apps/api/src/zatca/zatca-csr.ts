import { generateKeyPairSync, sign as ecdsaSign } from 'crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';

/**
 * CSR + key-pair generation for ZATCA onboarding (Detailed Technical
 * Guideline §3.3.3) — D-057, structure corrected against a real primary
 * source in D-059.
 *
 * **Verified against ZATCA's own OpenSSL config sample** — "E-Invoicing:
 * User Manual — Developer Portal Manual Version 3" §5.3.1 prints the literal
 * `.cnf` file ZATCA expects a CSR to be generated from. It splits the nine
 * business fields two ways, not one flat Subject DN as this file originally
 * assumed:
 *
 * - **Subject DN** (`[dn]`): only `C`, `OU`, `O`, `CN` — country, organization
 *   unit, organization name, common name.
 * - **`subjectAltName` extension, as a single `directoryName` GeneralName**
 *   (`[alt_names]`): `SN` (EGS Serial Number), `UID` (Organization
 *   Identifier/VAT number), `title` (Invoice Type), `registeredAddress`
 *   (Location), `businessCategory` (Industry) — five more
 *   AttributeTypeAndValue entries, but inside the extension, not the DN.
 * - **`certificateTemplateName` extension** (custom OID `1.3.6.1.4.1.311.20.2`,
 *   Microsoft's CA-template-name arc, ASN.1 PrintableString) fixed to the
 *   literal value `"ZATCA-Code-Signing"` — required, and previously missing
 *   entirely.
 * - **`basicConstraints` (`CA:FALSE`) and `keyUsage`
 *   (`digitalSignature, nonRepudiation, keyEncipherment`)** — also previously
 *   missing. The sample `.cnf` itself sets `req_extensions` twice (once to
 *   `v3_req`, which holds these two, then again to `req_ext`, which holds the
 *   other two) — under real OpenSSL's last-key-wins parsing only `req_ext`
 *   would actually apply, which may be a copy/paste artifact in ZATCA's own
 *   sample rather than intentional. Included here regardless: a superset of
 *   what the literal `.cnf` would produce is strictly safer than guessing
 *   which half ZATCA's own tooling meant to keep.
 *
 * All four extensions are carried the standard PKCS#10 way — wrapped in one
 * PKCS#9 `extensionRequest` attribute (OID `1.2.840.113549.1.9.14`) on the
 * CSR — not as literal X.509 extensions (a CSR has no certificate to attach
 * extensions to yet; `extensionRequest` is how a CSR asks the CA to include
 * them in the issued certificate).
 *
 * **What is still not verified**: the exact ASN.1 string types (PrintableString
 * vs UTF8String) for each attribute — the `.cnf` sample doesn't mark string
 * types explicitly, and this keeps the UTF8String choice used before pending
 * a clearer source.
 *
 * Curve: secp256k1, per this same manual's own §5.3.2.1 (which mislabels it
 * "P-256 (secp256k1)" — those are two different curves; secp256k1 is what
 * every accompanying command in both this manual and the earlier technical
 * guideline actually specifies, so that's what's implemented). Deliberately
 * signed with Node's classic `crypto` module rather than WebCrypto — Node's
 * WebCrypto only implements the browser-standard P-256/P-384/P-521 curves and
 * rejects secp256k1 outright, which is also why `pkijs`'s own `.sign()`
 * convenience method (WebCrypto-based) isn't used here; this builds the
 * ASN.1 structure with pkijs and supplies the signature itself.
 */

const OID = {
  countryName: '2.5.4.6',
  organizationalUnitName: '2.5.4.11',
  organizationName: '2.5.4.10',
  commonName: '2.5.4.3',
  /** "EGS Serial Number" — subjectAltName only, per the `.cnf`'s `[alt_names]` `SN=`. */
  serialNumber: '2.5.4.5',
  /** "Organization Identifier" (VAT/Group VAT number) — subjectAltName only, `.cnf`'s `UID=`. */
  userId: '0.9.2342.19200300.100.1.1',
  /** "Invoice Type" (functionality map) — subjectAltName only, `.cnf`'s `title=`. */
  title: '2.5.4.12',
  /** "Location" — subjectAltName only, `.cnf`'s `registeredAddress=`. */
  registeredAddress: '2.5.4.26',
  /** "Industry" — subjectAltName only, `.cnf`'s `businessCategory=`. */
  businessCategory: '2.5.4.15',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  /** Microsoft CA-template-name arc — ZATCA repurposes it to mark the CSR as a code-signing request. */
  certificateTemplateName: '1.3.6.1.4.1.311.20.2',
  extensionRequest: '1.2.840.113549.1.9.14',
} as const;

export interface ZatcaCsrFields {
  /** Name or Asset Tracking Number for the Solution Unit. */
  commonName: string;
  /** Manufacturer/Solution Provider Name, Model/Version and Serial Number, e.g. "1-Tailonix|2-1.0|3-<uuid>". */
  egsSerialNumber: string;
  /** 15-digit VAT or Group VAT Registration Number. */
  organizationIdentifier: string;
  /** Free text, or (VAT groups) the 10-digit TIN of the member being onboarded. */
  organizationUnitName: string;
  organizationName: string;
  /** ISO 3166 alpha-2 — "SA" for every real use of this system. */
  countryName: string;
  /** "TSXY" digits, e.g. "1100" for both standard and simplified invoices. */
  invoiceType: string;
  location: string;
  industry: string;
}

export interface ZatcaCsrResult {
  /** PEM PKCS#10 certificate signing request — submit this to the Compliance API. */
  csrPem: string;
  /** PEM EC private key — encrypt before persisting (see crypto.util.ts); never log or return this to a client after generation. */
  privateKeyPem: string;
}

function utf8(value: string): asn1js.Utf8String {
  return new asn1js.Utf8String({ value });
}

/** DER for a BIT STRING carrying exactly {digitalSignature, nonRepudiation, keyEncipherment} — bits 0,1,2. */
function keyUsageBitString(): ArrayBuffer {
  return new asn1js.BitString({ valueHex: new Uint8Array([0b1110_0000]).buffer, unusedBits: 5 }).toBER(false);
}

export function generateCsr(fields: ZatcaCsrFields): ZatcaCsrResult {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });

  const spkiAsn1 = asn1js.fromBER(
    spkiDer.buffer.slice(spkiDer.byteOffset, spkiDer.byteOffset + spkiDer.byteLength),
  );
  if (spkiAsn1.offset === -1) throw new Error('Failed to parse generated public key');

  const cr = new pkijs.CertificationRequest();
  cr.version = 0;
  cr.subject.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({ type: OID.countryName, value: new asn1js.PrintableString({ value: fields.countryName }) }),
    new pkijs.AttributeTypeAndValue({ type: OID.organizationalUnitName, value: utf8(fields.organizationUnitName) }),
    new pkijs.AttributeTypeAndValue({ type: OID.organizationName, value: utf8(fields.organizationName) }),
    new pkijs.AttributeTypeAndValue({ type: OID.commonName, value: utf8(fields.commonName) }),
  );
  cr.subjectPublicKeyInfo = new pkijs.PublicKeyInfo({ schema: spkiAsn1.result });
  cr.signatureAlgorithm = new pkijs.AlgorithmIdentifier({ algorithmId: OID.ecdsaWithSha256 });
  // Placeholder so encodeTBS() (which reads this.signatureAlgorithm but not
  // this.signatureValue) has something to work from; replaced below.
  cr.signatureValue = new asn1js.BitString({ valueHex: new ArrayBuffer(0) });

  const altNames = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({ type: OID.serialNumber, value: utf8(fields.egsSerialNumber) }),
      new pkijs.AttributeTypeAndValue({ type: OID.userId, value: utf8(fields.organizationIdentifier) }),
      new pkijs.AttributeTypeAndValue({ type: OID.title, value: utf8(fields.invoiceType) }),
      new pkijs.AttributeTypeAndValue({ type: OID.registeredAddress, value: utf8(fields.location) }),
      new pkijs.AttributeTypeAndValue({ type: OID.businessCategory, value: utf8(fields.industry) }),
    ],
  });
  const subjectAltNameExtension = new pkijs.Extension({
    extnID: OID.subjectAltName,
    critical: false,
    extnValue: new pkijs.GeneralNames({ names: [new pkijs.GeneralName({ type: 4, value: altNames })] })
      .toSchema()
      .toBER(false),
  });

  const basicConstraintsExtension = new pkijs.Extension({
    extnID: OID.basicConstraints,
    critical: false,
    extnValue: new pkijs.BasicConstraints({ cA: false }).toSchema().toBER(false),
  });

  const keyUsageExtension = new pkijs.Extension({
    extnID: OID.keyUsage,
    critical: false,
    extnValue: keyUsageBitString(),
  });

  const certificateTemplateNameExtension = new pkijs.Extension({
    extnID: OID.certificateTemplateName,
    critical: false,
    extnValue: new asn1js.PrintableString({ value: 'ZATCA-Code-Signing' }).toBER(false),
  });

  const extensions = new pkijs.Extensions({
    extensions: [basicConstraintsExtension, keyUsageExtension, certificateTemplateNameExtension, subjectAltNameExtension],
  });
  cr.attributes = [new pkijs.Attribute({ type: OID.extensionRequest, values: [extensions.toSchema()] })];

  // `encodeTBS` is `protected` in pkijs's TypeScript surface, but that's a
  // compile-time-only restriction; at runtime it's an ordinary method, and
  // reusing pkijs's own (tested) TBS assembly is safer than reimplementing
  // RFC 2986's CertificationRequestInfo SEQUENCE by hand.
  const tbs = (cr as unknown as { encodeTBS(): asn1js.Sequence }).encodeTBS();
  const tbsDer = Buffer.from(tbs.toBER(false));

  const signature = ecdsaSign('sha256', tbsDer, { key: privateKeyPem, dsaEncoding: 'der' });
  cr.signatureValue = new asn1js.BitString({
    valueHex: signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength),
  });

  const der = Buffer.from(cr.toSchema(true).toBER(false));
  const csrPem = `-----BEGIN CERTIFICATE REQUEST-----\n${der
    .toString('base64')
    .match(/.{1,64}/g)!
    .join('\n')}\n-----END CERTIFICATE REQUEST-----\n`;

  return { csrPem, privateKeyPem };
}
