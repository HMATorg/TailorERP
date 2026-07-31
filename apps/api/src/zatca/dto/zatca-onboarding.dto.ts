import { IsString, Length, MaxLength, MinLength } from 'class-validator';

export class RequestComplianceCsidDto {
  /** OTP obtained by a human from the real FATOORA portal / ZATCA Developer Portal. */
  @IsString()
  @Length(4, 12)
  otp: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  commonName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  egsSerialNumber: string;

  @IsString()
  @Length(15, 15)
  organizationIdentifier: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  organizationUnitName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  organizationName: string;

  @IsString()
  @Length(2, 2)
  countryName: string;

  @IsString()
  @Length(4, 4)
  invoiceType: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  location: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  industry: string;
}
