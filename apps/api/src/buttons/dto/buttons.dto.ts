import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** `data:image/<png|jpeg|jpg|webp>;base64,<payload>` — same shape as Organization.logoUrl (D-069). */
const DATA_URI_IMAGE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+=*$/;

export class CreateButtonDesignDto {
  /** The number on the shop's physical reference board, e.g. "153". */
  @IsString()
  @MaxLength(20)
  serialNumber: string;

  /** ~365KB raw image cap (500,000 base64 chars) — a catalog thumbnail, not a photo library. */
  @IsString()
  @MaxLength(500_000)
  @Matches(DATA_URI_IMAGE, { message: 'imageUrl must be a PNG/JPEG/WEBP data URI' })
  imageUrl: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  label?: string;
}

export class UpdateButtonDesignDto {
  @IsString()
  @MaxLength(20)
  @IsOptional()
  serialNumber?: string;

  @IsString()
  @MaxLength(500_000)
  @Matches(DATA_URI_IMAGE, { message: 'imageUrl must be a PNG/JPEG/WEBP data URI' })
  @IsOptional()
  imageUrl?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  label?: string;

  /** Retired buttons stay on past orders/tickets but drop out of the POS picker. */
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
