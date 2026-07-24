import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  defaultCurrency?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  timezone?: string;

  /** Plan code to subscribe the tenant to (e.g. 'enterprise'). */
  @IsString()
  planCode: string;

  /** HQ admin credentials generated for the client (PA-2). */
  @IsEmail()
  hqAdminEmail: string;

  @IsString()
  @MinLength(8)
  hqAdminPassword: string;

  @IsString()
  @IsOptional()
  hqAdminFullName?: string;

  /** Name for the initial headquarters store. */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  hqStoreName?: string;
}

export class UpdateOrganizationDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsIn(['active', 'suspended'])
  @IsOptional()
  status?: 'active' | 'suspended';
}

export class ChangeSubscriptionDto {
  @IsUUID()
  @IsOptional()
  planId?: string;

  @IsString()
  @IsOptional()
  planCode?: string;

  @IsIn(['trialing', 'active', 'past_due', 'suspended', 'cancelled'])
  @IsOptional()
  status?: string;

  /** Extend/replace the current period end (ISO date). */
  @IsString()
  @IsOptional()
  currentPeriodEnd?: string;

  @IsString()
  @IsOptional()
  trialEndsAt?: string;
}

export class UpsertPlanDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(50)
  code: string;

  @IsInt()
  @Min(1)
  maxStores: number;

  @IsInt()
  @Min(1)
  maxUsers: number;

  @IsArray()
  @IsString({ each: true })
  features: string[];

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  @Type(() => Number)
  monthlyPrice?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  @Type(() => Number)
  yearlyPrice?: number;

  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  stripeMonthlyPriceId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  stripeYearlyPriceId?: string;
}
