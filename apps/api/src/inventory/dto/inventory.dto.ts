import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBatchDto {
  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @IsString()
  @MaxLength(255)
  fabricName: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  fabricCode?: string;

  @IsString()
  @MaxLength(100)
  batchCode: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  color?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  unit?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  costPricePerUnit: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  @Min(0)
  sellingPricePerUnit?: number;

  @IsDateString()
  purchaseDate: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  storageLocation?: string;
}

export class TransferDto {
  @IsUUID()
  batchId: string;

  @IsUUID()
  destinationStoreId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity: number;

  @IsString()
  @IsOptional()
  note?: string;
}

export class AdjustBatchDto {
  /** Positive or negative delta applied to current quantity. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  delta: number;

  @IsString()
  note: string;
}

export class ResolveAlertDto {
  @IsString()
  @IsOptional()
  note?: string;
}

export class AlertActionDto {
  @IsIn(['acknowledged', 'ordered'])
  status: 'acknowledged' | 'ordered';
}

export class UpsertReorderSettingDto {
  @IsString()
  @MaxLength(255)
  fabricName: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minThreshold: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  @Min(0)
  maxThreshold?: number;

  @IsOptional()
  @Min(0)
  leadTimeDays?: number;
}
