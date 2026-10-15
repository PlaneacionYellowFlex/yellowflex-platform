-- CreateEnum
CREATE TYPE "WarehouseCountType" AS ENUM ('CYCLE', 'SURPRISE');

-- CreateEnum
CREATE TYPE "WarehouseCountStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WarehouseCount" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" "WarehouseCountType" NOT NULL,
    "status" "WarehouseCountStatus" NOT NULL DEFAULT 'OPEN',
    "expectedQuantity" DECIMAL(18,3) NOT NULL,
    "countedQuantity" DECIMAL(18,3),
    "difference" DECIMAL(18,3),
    "notes" TEXT,
    "launchedAt" TIMESTAMP(3) NOT NULL,
    "countedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "countedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseCount_folio_key" ON "WarehouseCount"("folio");

-- CreateIndex
CREATE INDEX "WarehouseCount_status_launchedAt_idx" ON "WarehouseCount"("status", "launchedAt");

-- CreateIndex
CREATE INDEX "WarehouseCount_itemId_locationId_launchedAt_idx" ON "WarehouseCount"("itemId", "locationId", "launchedAt");

-- AddForeignKey
ALTER TABLE "WarehouseCount" ADD CONSTRAINT "WarehouseCount_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseCount" ADD CONSTRAINT "WarehouseCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseCount" ADD CONSTRAINT "WarehouseCount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseCount" ADD CONSTRAINT "WarehouseCount_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
