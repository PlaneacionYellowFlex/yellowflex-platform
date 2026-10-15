CREATE TABLE "WarehouseDiscrepancyRecount" (
 "id" TEXT NOT NULL,
 "folio" TEXT NOT NULL,
 "discrepancyId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'OPEN',
 "expectedQuantity" DECIMAL(18,3) NOT NULL,
 "countedQuantity" DECIMAL(18,3),
 "difference" DECIMAL(18,3),
 "reason" TEXT NOT NULL,
 "notes" TEXT,
 "requestedById" TEXT NOT NULL,
 "completedById" TEXT,
 "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completedAt" TIMESTAMP(3),
 CONSTRAINT "WarehouseDiscrepancyRecount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WarehouseDiscrepancyRecount_folio_key" ON "WarehouseDiscrepancyRecount"("folio");
CREATE INDEX "WarehouseDiscrepancyRecount_discrepancyId_requestedAt_idx" ON "WarehouseDiscrepancyRecount"("discrepancyId","requestedAt");
CREATE UNIQUE INDEX "WarehouseDiscrepancyRecount_one_open_idx" ON "WarehouseDiscrepancyRecount"("discrepancyId") WHERE "status" = 'OPEN';
ALTER TABLE "WarehouseDiscrepancyRecount" ADD CONSTRAINT "WarehouseDiscrepancyRecount_discrepancyId_fkey" FOREIGN KEY ("discrepancyId") REFERENCES "WarehouseDiscrepancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseDiscrepancyRecount" ADD CONSTRAINT "WarehouseDiscrepancyRecount_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseDiscrepancyRecount" ADD CONSTRAINT "WarehouseDiscrepancyRecount_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
