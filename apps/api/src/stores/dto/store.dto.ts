import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateStoreDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsBoolean()
  @IsOptional()
  isHeadquarters?: boolean;

  @IsObject()
  @IsOptional()
  operatingHours?: Record<string, { open: string; close: string }>;

  @IsString()
  @IsOptional()
  timezone?: string;
}

export class UpdateStoreDto extends CreateStoreDto {
  @IsString()
  @IsOptional()
  declare name: string;

  @IsIn(['active', 'paused', 'closed'])
  @IsOptional()
  status?: 'active' | 'paused' | 'closed';

  @IsString()
  @IsOptional()
  @MaxLength(50)
  whatsappPhoneNumberId?: string;

  /**
   * Plaintext in the request only — encrypted with TOKEN_ENCRYPTION_KEY before
   * it ever reaches the database (D-062) and never echoed back in any response.
   */
  @IsString()
  @IsOptional()
  whatsappAccessToken?: string;
}
