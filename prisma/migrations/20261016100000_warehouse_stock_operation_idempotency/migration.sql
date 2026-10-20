CREATE TYPE "WarehouseStockOperationKind" AS ENUM ('INTERNAL_TRANSFER');

CREATE TABLE "WarehouseStockOperation" (
    "id" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "operationPayloadHash" VARCHAR(128) NOT NULL,
    "kind" "WarehouseStockOperationKind" NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestBody" JSONB,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WarehouseStockOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WarehouseStockOperation_operationKey_key" ON "WarehouseStockOperation"("operationKey");

CREATE INDEX "WarehouseStockOperation_actorId_createdAt_idx" ON "WarehouseStockOperation"("actorId", "createdAt");

CREATE INDEX "WarehouseStockOperation_kind_createdAt_idx" ON "WarehouseStockOperation"("kind", "createdAt");

ALTER TABLE "WarehouseStockOperation" ADD CONSTRAINT "WarehouseStockOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;