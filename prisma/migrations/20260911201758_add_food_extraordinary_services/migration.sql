-- CreateEnum
CREATE TYPE "FoodExtraordinaryGuestType" AS ENUM ('PROVIDER', 'VISITOR', 'NEW_HIRE', 'OTHER');

-- CreateEnum
CREATE TYPE "FoodExtraordinaryChargeType" AS ENUM ('YELLOWFLEX', 'PROVIDER', 'COURTESY', 'OTHER');

-- CreateEnum
CREATE TYPE "FoodExtraordinaryStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateTable
CREATE TABLE "FoodExtraordinaryService" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestType" "FoodExtraordinaryGuestType" NOT NULL,
    "company" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceApplied" DECIMAL(10,2) NOT NULL,
    "chargeType" "FoodExtraordinaryChargeType" NOT NULL,
    "areaResponsible" TEXT,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "status" "FoodExtraordinaryStatus" NOT NULL DEFAULT 'ACTIVE',
    "authorizedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "FoodExtraordinaryService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FoodExtraordinaryService_menuItemId_status_idx" ON "FoodExtraordinaryService"("menuItemId", "status");

-- CreateIndex
CREATE INDEX "FoodExtraordinaryService_authorizedById_createdAt_idx" ON "FoodExtraordinaryService"("authorizedById", "createdAt");

-- CreateIndex
CREATE INDEX "FoodExtraordinaryService_createdAt_idx" ON "FoodExtraordinaryService"("createdAt");

-- AddForeignKey
ALTER TABLE "FoodExtraordinaryService" ADD CONSTRAINT "FoodExtraordinaryService_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodExtraordinaryService" ADD CONSTRAINT "FoodExtraordinaryService_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
