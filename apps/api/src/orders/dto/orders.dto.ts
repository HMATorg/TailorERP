import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ORDER_STATUSES, PAYMENT_METHODS, type OrderStatus, type PaymentMethod } from '@tailonix/shared';

export class ExplicitBatchAllocationDto {
  @IsUUID()
  batchId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity: number;
}

export class OrderItemFabricDto {
  @IsString()
  @MaxLength(255)
  fabricName: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity: number;

  /**
   * Optional explicit batch selection (wireframes §3.3). When omitted, the
   * system consumes oldest-first automatically (TRD §5.1 FIFO).
   */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExplicitBatchAllocationDto)
  @IsOptional()
  batchAllocations?: ExplicitBatchAllocationDto[];
}

export class CreateOrderItemDto {
  @IsString()
  @MaxLength(100)
  garmentType: string;

  @IsString()
  @IsOptional()
  description?: string;

  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice: number;

  @IsUUID()
  @IsOptional()
  measurementId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemFabricDto)
  @IsOptional()
  fabrics?: OrderItemFabricDto[];
}

export class CreateOrderDto {
  @IsUUID()
  customerId: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  discountAmount?: number;

  /** Rush order flag (D-055) — "مستعجل" on a real tailor shop's order form. */
  @IsBoolean()
  @IsOptional()
  isUrgent?: boolean;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}

export class UpdateOrderStatusDto {
  @IsIn(ORDER_STATUSES as readonly string[])
  status: OrderStatus;

  @IsString()
  @IsOptional()
  note?: string;
}

export class AddPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsIn(PAYMENT_METHODS as readonly string[])
  @IsOptional()
  method?: PaymentMethod;

  @IsString()
  @IsOptional()
  reference?: string;
}
