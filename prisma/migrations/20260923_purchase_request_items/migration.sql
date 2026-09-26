-- YellowFlex Purchases: multiple line items per purchase request.
CREATE TABLE "PurchaseRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseRequestItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseRequestItem_requestId_position_idx"
ON "PurchaseRequestItem"("requestId", "position");

ALTER TABLE "PurchaseRequestItem"
ADD CONSTRAINT "PurchaseRequestItem_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
