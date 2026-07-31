-- CreateEnum
CREATE TYPE "CutStyle" AS ENUM ('saudi', 'kuwaiti', 'qatari', 'other');

-- AlterTable
ALTER TABLE "measurements" ADD COLUMN     "m10_round_shoulder" DECIMAL(6,2),
ADD COLUMN     "m11_mid_hand" DECIMAL(6,2),
ADD COLUMN     "m12_plate_length" DECIMAL(6,2),
ADD COLUMN     "m13_half_chest" DECIMAL(6,2),
ADD COLUMN     "m9_waist" DECIMAL(6,2);

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "cufflink_size" VARCHAR(20),
ADD COLUMN     "cut_style" "CutStyle";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "is_urgent" BOOLEAN NOT NULL DEFAULT false;
