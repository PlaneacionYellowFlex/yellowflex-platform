-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('INITIAL_BALANCE', 'EXTERNAL_RECEIPT', 'EXTERNAL_ISSUE', 'INTERNAL_TRANSFER', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');

-- CreateTable
CREATE TABLE "WarehousePermission" (
    "userId" TEXT NOT NULL,
    "canViewInventory" BOOLEAN NOT NULL DEFAULT false,
    "canRegisterMovement" BOOLEAN NOT NULL DEFAULT false,
    "canImportInitial" BOOLEAN NOT NULL DEFAULT false,
    "canManageCatalog" BOOLEAN NOT NULL DEFAULT false,
    "canManageWarehouse" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehousePermission_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseLocation" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "originLocationId" TEXT,
    "destinationLocationId" TEXT,
    "referenceType" TEXT,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_code_key" ON "InventoryItem"("code");

-- CreateIndex
CREATE INDEX "InventoryItem_active_code_idx" ON "InventoryItem"("active", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE INDEX "Warehouse_active_name_idx" ON "Warehouse"("active", "name");

-- CreateIndex
CREATE INDEX "WarehouseLocation_warehouseId_active_idx" ON "WarehouseLocation"("warehouseId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLocation_warehouseId_code_key" ON "WarehouseLocation"("warehouseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_folio_key" ON "InventoryMovement"("folio");

-- CreateIndex
CREATE INDEX "InventoryMovement_itemId_occurredAt_idx" ON "InventoryMovement"("itemId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_originLocationId_occurredAt_idx" ON "InventoryMovement"("originLocationId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_destinationLocationId_occurredAt_idx" ON "InventoryMovement"("destinationLocationId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_type_occurredAt_idx" ON "InventoryMovement"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_actorId_occurredAt_idx" ON "InventoryMovement"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_referenceType_referenceNumber_idx" ON "InventoryMovement"("referenceType", "referenceNumber");

-- AddForeignKey
ALTER TABLE "WarehousePermission" ADD CONSTRAINT "WarehousePermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_originLocationId_fkey" FOREIGN KEY ("originLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
