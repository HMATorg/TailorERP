import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const E164 = /^\+[1-9]\d{7,14}$/;

export class CreateCustomerDto {
  @IsString()
  @MaxLength(255)
  fullName: string;

  @Matches(E164, { message: 'phone must be E.164 format, e.g. +9665xxxxxxxx' })
  phone: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsBoolean()
  @IsOptional()
  whatsappConsent?: boolean;

  @Matches(E164)
  @IsOptional()
  whatsappPhone?: string;

  @IsIn(['en', 'ar', 'ur'])
  @IsOptional()
  language?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateCustomerDto extends CreateCustomerDto {
  @IsString()
  @IsOptional()
  declare fullName: string;

  @IsOptional()
  declare phone: string;
}

export class CreateMeasurementDto {
  @IsString()
  @MaxLength(100)
  garmentType: string;

  /** e.g. { collar: 15.5, chest: 40, sleeve: 24 } — unit convention: inches */
  @IsObject()
  data: Record<string, number | string>;

  @IsString()
  @IsOptional()
  notes?: string;
}
