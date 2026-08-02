import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
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

/**
 * Measurement matrix M1–M8 (v4 amendment §2). All values in CENTIMETRES.
 * Saving creates a new version and deactivates the previous one, so cutters
 * always read a single active frame.
 */
export class CreateMeasurementDto {
  @IsString()
  @MaxLength(100)
  garmentType: string;

  // M1 and M3 split into front/back and left/right (D-068) — see the schema
  // comment on Measurement.m1FrontLength for why these replace the old
  // single m1TotalLength/m3SleeveLength fields rather than sitting alongside them.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m1FrontLength?: number; // الطول الأمامي

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m1BackLength?: number; // الطول الخلفي

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m2ShoulderWidth?: number; // الكتف

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m3SleeveLeft?: number; // الكم الأيسر

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m3SleeveRight?: number; // الكم الأيمن

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m4ChestCirc?: number; // الصدر

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m5HipWidth?: number; // الوسط

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m6NeckDiameter?: number; // الرقبة

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m7WristOpening?: number; // الوسع

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m8SkirtPerimeter?: number; // الذيل

  // M9-M13 (D-055), added against a real tailor shop's own paper order form.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m9Waist?: number; // الوسط

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m10RoundShoulder?: number; // الكتف المدور

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m11MidHand?: number; // منتصف اليد

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m12PlateLength?: number; // طول اللوح

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  m13HalfChest?: number; // نصف الصدر

  // Trousers points, T1-T7 (D-054) — not a robe, so not part of the M-matrix above.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  t1Waist?: number; // الخصر

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  t2Hip?: number; // الورك

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  t3Inseam?: number; // الداخلي

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  t4Outseam?: number; // الطول الكلي

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  t5Thigh?: number; // الفخذ

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  t6Knee?: number; // الركبة

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  @IsOptional()
  t7AnkleOpening?: number; // فتحة الأسفل

  /** Trousers/shalwar palla widths (D-068) — a variable-count list a tailor
   * adds one at a time, not a fixed matrix point like T1-T7. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrouserPallaDto)
  @IsOptional()
  trouserPallas?: TrouserPallaDto[];

  /** Shop-specific points outside the standard matrix */
  @IsObject()
  @IsOptional()
  extra?: Record<string, number | string>;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class TrouserPallaDto {
  @IsString()
  @MaxLength(50)
  label: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  valueCm: number;
}
