import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

export class StaffLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(32)
  refreshToken: string;
}

const E164 = /^\+[1-9]\d{7,14}$/;

export class OtpRequestDto {
  @Matches(E164, { message: 'phone must be E.164 format, e.g. +9665xxxxxxxx' })
  phone: string;

  @IsUUID()
  @IsOptional()
  organizationId?: string;
}

export class OtpVerifyDto {
  @Matches(E164, { message: 'phone must be E.164 format, e.g. +9665xxxxxxxx' })
  phone: string;

  @IsString()
  @Length(4, 8)
  code: string;

  @IsUUID()
  @IsOptional()
  organizationId?: string;
}
