ALTER TABLE "WarehousePermission"
  ADD COLUMN "canApproveWarehouseAdjustments" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "WarehouseDiscrepancy"
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedQuantity" DECIMAL(18,3),
  ADD COLUMN "movementId" TEXT;

CREATE UNIQUE INDEX "WarehouseDiscrepancy_movementId_key"
  ON "WarehouseDiscrepancy"("movementId");

ALTER TABLE "WarehouseDiscrepancy"
  ADD CONSTRAINT "WarehouseDiscrepancy_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WarehouseDiscrepancy"
  ADD CONSTRAINT "WarehouseDiscrepancy_movementId_fkey"
  FOREIGN KEY ("movementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "InventoryMovement_warehouse_discrepancy_reference_key"
  ON "InventoryMovement"("referenceNumber")
  WHERE "referenceType" = 'WAREHOUSE_DISCREPANCY';
