-- CreateEnum
CREATE TYPE "FoodOrderStatus" AS ENUM ('CONFIRMED');

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "foodOrderId" TEXT;

-- CreateTable
CREATE TABLE "FoodOrder" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "menuWeekId" TEXT NOT NULL,
    "status" "FoodOrderStatus" NOT NULL DEFAULT 'CONFIRMED',
    "itemCount" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FoodOrder_menuWeekId_status_idx" ON "FoodOrder"("menuWeekId", "status");

-- CreateIndex
CREATE INDEX "FoodOrder_confirmedAt_idx" ON "FoodOrder"("confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FoodOrder_employeeId_menuWeekId_key" ON "FoodOrder"("employeeId", "menuWeekId");

-- CreateIndex
CREATE INDEX "Reservation_foodOrderId_idx" ON "Reservation"("foodOrderId");

-- AddForeignKey
ALTER TABLE "FoodOrder" ADD CONSTRAINT "FoodOrder_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodOrder" ADD CONSTRAINT "FoodOrder_menuWeekId_fkey" FOREIGN KEY ("menuWeekId") REFERENCES "MenuWeek"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_foodOrderId_fkey" FOREIGN KEY ("foodOrderId") REFERENCES "FoodOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
