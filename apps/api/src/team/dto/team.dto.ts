import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { STORE_ROLES, type StoreRole } from '@tailonix/shared';

export class StoreAssignmentDto {
  @IsUUID()
  storeId: string;

  @IsIn(STORE_ROLES as readonly string[])
  role: StoreRole;

  /** Optional per-user overrides: { grant: [...], revoke: [...] } (PRD §4.6) */
  @IsObject()
  @IsOptional()
  permissions?: { grant?: string[]; revoke?: string[] };
}

export class InviteUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  fullName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  phone?: string;

  /** Grant org-wide HQ admin access (only an HQ admin can grant this). */
  @IsBoolean()
  @IsOptional()
  asHqAdmin?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreAssignmentDto)
  @IsOptional()
  assignments?: StoreAssignmentDto[];

  /**
   * When set, the user is created active immediately with this password —
   * no invitation row, no email. Omit to keep the normal email-invite flow.
   */
  @IsString()
  @IsOptional()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password?: string;
}

export class AcceptInviteDto {
  @IsString()
  @MinLength(32)
  token: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  fullName?: string;
}

export class UpdateUserRolesDto {
  @IsBoolean()
  @IsOptional()
  asHqAdmin?: boolean;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => StoreAssignmentDto)
  @IsOptional()
  assignments?: StoreAssignmentDto[];
}

export class UpdateUserStatusDto {
  @IsBoolean()
  isActive: boolean;
}
