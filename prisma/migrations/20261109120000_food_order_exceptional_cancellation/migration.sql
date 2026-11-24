ALTER TYPE "FoodOrderStatus" ADD VALUE 'CANCELLED';
CREATE TYPE "FoodOrderPayrollStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'EXPORTED', 'PROCESSED');
ALTER TABLE "FoodOrder"
  ADD COLUMN "payrollStatus" "FoodOrderPayrollStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "payrollExportedAt" TIMESTAMP(3),
  ADD COLUMN "payrollExportedById" TEXT;
ALTER TABLE "FoodOrder" ADD CONSTRAINT "FoodOrder_payrollExportedById_fkey"
  FOREIGN KEY ("payrollExportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "FoodOrderCancellation" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "previousStatus" "FoodOrderStatus" NOT NULL,
  "newStatus" "FoodOrderStatus" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FoodOrderCancellation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FoodOrderCancellation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "FoodOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FoodOrderCancellation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FoodOrderCancellation_orderId_key" ON "FoodOrderCancellation"("orderId");
CREATE INDEX "FoodOrderCancellation_actorId_createdAt_idx" ON "FoodOrderCancellation"("actorId", "createdAt");
