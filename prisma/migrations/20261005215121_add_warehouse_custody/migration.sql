-- CreateEnum
CREATE TYPE "InventoryCustodyStatus" AS ENUM ('AVAILABLE', 'REQUESTED', 'IN_TRANSIT', 'IN_INSPECTION', 'HELD', 'RELEASED', 'REWORK', 'NONCONFORMING_PRODUCT', 'CONCESSION_DEVIATION', 'CONSUMED_IN_TEST', 'CLOSED');

-- CreateEnum
CREATE TYPE "InventoryCustodyEventType" AS ENUM ('CREATED', 'REQUESTED', 'TRANSFERRED', 'RECEIVED', 'INSPECTION_STARTED', 'HELD', 'RELEASED', 'SENT_TO_REWORK', 'REWORK_COMPLETED', 'CLASSIFIED_NONCONFORMING', 'CONCESSION_DEVIATION_GRANTED', 'CONSUMED_IN_TEST', 'RETURNED', 'NEXT_ACTION_ASSIGNED', 'CLOSED');

-- CreateTable
CREATE TABLE "OperationalArea" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCustody" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "locationId" TEXT,
    "custodianAreaId" TEXT NOT NULL,
    "nextActionAreaId" TEXT,
    "status" "InventoryCustodyStatus" NOT NULL,
    "reason" TEXT,
    "referenceType" TEXT,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCustody_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCustodyEvent" (
    "id" TEXT NOT NULL,
    "custodyId" TEXT NOT NULL,
    "type" "InventoryCustodyEventType" NOT NULL,
    "fromAreaId" TEXT,
    "toAreaId" TEXT,
    "fromStatus" "InventoryCustodyStatus",
    "toStatus" "InventoryCustodyStatus",
    "quantity" DECIMAL(18,3),
    "reason" TEXT,
    "notes" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryCustodyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OperationalArea_code_key" ON "OperationalArea"("code");

-- CreateIndex
CREATE INDEX "OperationalArea_active_name_idx" ON "OperationalArea"("active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCustody_folio_key" ON "InventoryCustody"("folio");

-- CreateIndex
CREATE INDEX "InventoryCustody_itemId_status_idx" ON "InventoryCustody"("itemId", "status");

-- CreateIndex
CREATE INDEX "InventoryCustody_locationId_status_idx" ON "InventoryCustody"("locationId", "status");

-- CreateIndex
CREATE INDEX "InventoryCustody_custodianAreaId_status_enteredAt_idx" ON "InventoryCustody"("custodianAreaId", "status", "enteredAt");

-- CreateIndex
CREATE INDEX "InventoryCustody_nextActionAreaId_status_enteredAt_idx" ON "InventoryCustody"("nextActionAreaId", "status", "enteredAt");

-- CreateIndex
CREATE INDEX "InventoryCustody_referenceType_referenceNumber_idx" ON "InventoryCustody"("referenceType", "referenceNumber");

-- CreateIndex
CREATE INDEX "InventoryCustodyEvent_custodyId_occurredAt_idx" ON "InventoryCustodyEvent"("custodyId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryCustodyEvent_fromAreaId_occurredAt_idx" ON "InventoryCustodyEvent"("fromAreaId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryCustodyEvent_toAreaId_occurredAt_idx" ON "InventoryCustodyEvent"("toAreaId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryCustodyEvent_actorId_occurredAt_idx" ON "InventoryCustodyEvent"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryCustodyEvent_type_occurredAt_idx" ON "InventoryCustodyEvent"("type", "occurredAt");

-- AddForeignKey
ALTER TABLE "InventoryCustody" ADD CONSTRAINT "InventoryCustody_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCustody" ADD CONSTRAINT "InventoryCustody_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCustody" ADD CONSTRAINT "InventoryCustody_custodianAreaId_fkey" FOREIGN KEY ("custodianAreaId") REFERENCES "OperationalArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCustody" ADD CONSTRAINT "InventoryCustody_nextActionAreaId_fkey" FOREIGN KEY ("nextActionAreaId") REFERENCES "OperationalArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCustody" ADD CONSTRAINT "InventoryCustody_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCustodyEvent" ADD CONSTRAINT "InventoryCustodyEvent_custodyId_fkey" FOREIGN KEY ("custodyId") REFERENCES "InventoryCustody"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCustodyEvent" ADD CONSTRAINT "InventoryCustodyEvent_fromAreaId_fkey" FOREIGN KEY ("fromAreaId") REFERENCES "OperationalArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCustodyEvent" ADD CONSTRAINT "InventoryCustodyEvent_toAreaId_fkey" FOREIGN KEY ("toAreaId") REFERENCES "OperationalArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCustodyEvent" ADD CONSTRAINT "InventoryCustodyEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
