import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CollarStyle,
  CuffStyle,
  CutStyle,
  PocketStyle,
  StitchingStyle,
} from '@prisma/client';

export class PosLookupDto {
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'phone must be E.164, e.g. +9665xxxxxxxx' })
  phone: string;
}

/** One garment tab in the POS (v4 Phase 1 §3). */
export class PosGarmentDto {
  @IsString()
  @MaxLength(100)
  garmentType: string;

  /** The roll this garment is cut from */
  @IsUUID()
  fabricBatchId: string;

  @IsEnum(CollarStyle)
  @IsOptional()
  collarStyle?: CollarStyle;

  @IsEnum(CuffStyle)
  @IsOptional()
  cuffStyle?: CuffStyle;

  @IsEnum(PocketStyle)
  @IsOptional()
  pocketStyle?: PocketStyle;

  @IsEnum(StitchingStyle)
  @IsOptional()
  stitchingStyle?: StitchingStyle;

  /** Regional cut (D-055) — Thobe-oriented; leave unset for other garment types. */
  @IsEnum(CutStyle)
  @IsOptional()
  cutStyle?: CutStyle;

  /** Free text, e.g. "9x3" — a manufacturing spec, not a body measurement (D-055) */
  @IsString()
  @MaxLength(20)
  @IsOptional()
  cufflinkSize?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice: number;

  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsString()
  @IsOptional()
  description?: string;
}

export class PosCheckoutDto {
  @IsUUID()
  customerId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PosGarmentDto)
  items: PosGarmentDto[];

  /** Typically 50% at the counter (v4 Phase 3 §1) */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  depositAmount?: number;

  @IsIn(['cash', 'card', 'transfer', 'other'])
  @IsOptional()
  depositMethod?: 'cash' | 'card' | 'transfer' | 'other';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  discountAmount?: number;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  /** Rush order flag (D-055) — "مستعجل" on a real tailor shop's order form. */
  @IsBoolean()
  @IsOptional()
  isUrgent?: boolean;
}

export class PosSettleDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsIn(['cash', 'card', 'transfer', 'other'])
  @IsOptional()
  method?: string;
}
