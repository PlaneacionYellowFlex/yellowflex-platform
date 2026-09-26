-- CreateEnum
CREATE TYPE "PurchaseAuthorizationStatus" AS ENUM ('PENDING', 'INFORMATION_REQUIRED', 'AUTHORIZED', 'REJECTED', 'REGULARIZATION_PENDING', 'REGULARIZED', 'REGULARIZATION_REJECTED');

-- CreateEnum
CREATE TYPE "PurchaseDocumentStatus" AS ENUM ('PENDING', 'INVOICE_PENDING', 'COMPLETE');

-- CreateEnum
CREATE TYPE "PurchaseDecisionType" AS ENUM ('AUTHORIZE', 'REJECT', 'REQUEST_INFORMATION', 'REGULARIZE', 'REJECT_REGULARIZATION');

-- CreateEnum
CREATE TYPE "PurchaseDocumentType" AS ENUM ('QUOTATION', 'INVOICE');

-- CreateEnum
CREATE TYPE "PurchaseEventType" AS ENUM ('REQUEST_CREATED', 'REQUEST_UPDATED', 'INFORMATION_PROVIDED', 'DECISION_RECORDED', 'PURCHASE_RECORDED', 'DOCUMENT_UPLOADED', 'DOCUMENT_SUPERSEDED', 'DOCUMENT_COMPLETED');

-- CreateTable
CREATE TABLE "PurchasePermission" (
    "userId" TEXT NOT NULL,
    "canRequest" BOOLEAN NOT NULL DEFAULT false,
    "canRequestUrgent" BOOLEAN NOT NULL DEFAULT false,
    "canAuthorize" BOOLEAN NOT NULL DEFAULT false,
    "canViewAll" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchasePermission_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "requesterDepartment" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "requiredDate" DATE,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "urgencyReason" TEXT,
    "authorizationStatus" "PurchaseAuthorizationStatus" NOT NULL DEFAULT 'PENDING',
    "documentStatus" "PurchaseDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "purchasedAt" TIMESTAMP(3),
    "purchaseRecordedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseDecision" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decision" "PurchaseDecisionType" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" "PurchaseDocumentType" NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "replacementReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "eventType" "PurchaseEventType" NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_folio_key" ON "PurchaseRequest"("folio");

-- CreateIndex
CREATE INDEX "PurchaseRequest_requesterId_createdAt_idx" ON "PurchaseRequest"("requesterId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseRequest_authorizationStatus_createdAt_idx" ON "PurchaseRequest"("authorizationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseRequest_documentStatus_createdAt_idx" ON "PurchaseRequest"("documentStatus", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseRequest_isUrgent_authorizationStatus_idx" ON "PurchaseRequest"("isUrgent", "authorizationStatus");

-- CreateIndex
CREATE INDEX "PurchaseDecision_requestId_createdAt_idx" ON "PurchaseDecision"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseDecision_decidedById_createdAt_idx" ON "PurchaseDecision"("decidedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDocument_storageKey_key" ON "PurchaseDocument"("storageKey");

-- CreateIndex
CREATE INDEX "PurchaseDocument_requestId_type_createdAt_idx" ON "PurchaseDocument"("requestId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseDocument_uploadedById_createdAt_idx" ON "PurchaseDocument"("uploadedById", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseEvent_requestId_createdAt_idx" ON "PurchaseEvent"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseEvent_actorId_createdAt_idx" ON "PurchaseEvent"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "PurchasePermission" ADD CONSTRAINT "PurchasePermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDecision" ADD CONSTRAINT "PurchaseDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDecision" ADD CONSTRAINT "PurchaseDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "PurchaseDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEvent" ADD CONSTRAINT "PurchaseEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEvent" ADD CONSTRAINT "PurchaseEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
