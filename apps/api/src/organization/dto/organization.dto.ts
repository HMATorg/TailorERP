import { IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

/** `data:image/<png|jpeg|jpg|webp>;base64,<payload>` — see organization.service.ts for why. */
const DATA_URI_IMAGE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+=*$/;

export class UpdateOrganizationDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  vatNumber?: string;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  crNumber?: string;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  licenseNumber?: string;

  /** Liability/policy note printed on the thermal receipt when set (D-072). */
  @IsString()
  @MaxLength(500)
  @IsOptional()
  receiptNote?: string;

  /**
   * The logo itself, not a pointer to it — a data URI stored directly in the
   * column. A shop's logo is looked up once per login and embedded on every
   * receipt/invoice print; a plain string column that needs no signed URL,
   * no expiry, and no object-storage dependency in dev is the right amount of
   * infrastructure for something this small (D-069). ~365KB raw image cap
   * (500,000 base64 chars) keeps it well clear of any request-body limit.
   *
   * `null` (not just omitted) is a valid value — it is how the admin UI
   * removes a logo, so it must skip the data-URI format check rather than
   * fail it.
   */
  @ValidateIf((o: UpdateOrganizationDto) => o.logoUrl !== null)
  @IsString()
  @MaxLength(500_000)
  @Matches(DATA_URI_IMAGE, { message: 'logoUrl must be a PNG/JPEG/WEBP data URI' })
  @IsOptional()
  logoUrl?: string | null;
}
