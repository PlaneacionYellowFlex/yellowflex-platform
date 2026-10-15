CREATE TABLE "WarehouseDiscrepancy" (
 "id" TEXT NOT NULL,
 "folio" TEXT NOT NULL,
 "countId" TEXT NOT NULL,
 "classification" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
 "status" TEXT NOT NULL DEFAULT 'OPEN',
 "cause" TEXT,
 "notes" TEXT,
 "resolution" TEXT,
 "assignedToId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 "closedAt" TIMESTAMP(3),
 CONSTRAINT "WarehouseDiscrepancy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WarehouseDiscrepancy_folio_key" ON "WarehouseDiscrepancy"("folio");
CREATE UNIQUE INDEX "WarehouseDiscrepancy_countId_key" ON "WarehouseDiscrepancy"("countId");
CREATE INDEX "WarehouseDiscrepancy_status_createdAt_idx" ON "WarehouseDiscrepancy"("status","createdAt");
ALTER TABLE "WarehouseDiscrepancy" ADD CONSTRAINT "WarehouseDiscrepancy_countId_fkey" FOREIGN KEY ("countId") REFERENCES "WarehouseCount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseDiscrepancy" ADD CONSTRAINT "WarehouseDiscrepancy_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "WarehouseDiscrepancy" ("id","folio","countId","classification","status","createdAt","updatedAt")
SELECT 'dis-' || c."id", 'DIS-' || substring(c."folio" from 5), c."id", 'UNCLASSIFIED', 'OPEN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "WarehouseCount" c
WHERE c."status" = 'COMPLETED' AND c."difference" IS NOT NULL AND c."difference" <> 0
ON CONFLICT ("countId") DO NOTHING;
