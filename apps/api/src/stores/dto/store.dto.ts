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
}
