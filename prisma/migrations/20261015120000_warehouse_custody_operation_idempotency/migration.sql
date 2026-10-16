CREATE TYPE "InventoryCustodyOperationKind" AS ENUM ('CONSUME_PRODUCTION_CUSTODY');

CREATE TABLE "InventoryCustodyOperation" (
    "id" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "operationPayloadHash" VARCHAR(128) NOT NULL,
    "custodyId" TEXT NOT NULL,
    "kind" "InventoryCustodyOperationKind" NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestBody" JSONB,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryCustodyOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryCustodyOperation_operationKey_key" ON "InventoryCustodyOperation"("operationKey");

CREATE INDEX "InventoryCustodyOperation_custodyId_createdAt_idx" ON "InventoryCustodyOperation"("custodyId", "createdAt");

CREATE INDEX "InventoryCustodyOperation_actorId_createdAt_idx" ON "InventoryCustodyOperation"("actorId", "createdAt");

CREATE INDEX "InventoryCustodyOperation_kind_createdAt_idx" ON "InventoryCustodyOperation"("kind", "createdAt");

ALTER TABLE "InventoryCustodyOperation" ADD CONSTRAINT "InventoryCustodyOperation_custodyId_fkey" FOREIGN KEY ("custodyId") REFERENCES "InventoryCustody"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryCustodyOperation" ADD CONSTRAINT "InventoryCustodyOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;