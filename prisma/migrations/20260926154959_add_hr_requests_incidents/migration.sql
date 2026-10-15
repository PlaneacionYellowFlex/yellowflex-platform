-- CreateEnum
CREATE TYPE "HrRequestType" AS ENUM ('VACATION', 'ABSENCE_PERMISSION', 'EARLY_DEPARTURE', 'LATE_ARRIVAL', 'HOURLY_PERMISSION', 'ABSENCE_JUSTIFICATION', 'LATE_JUSTIFICATION', 'MEDICAL_LEAVE');

-- CreateEnum
CREATE TYPE "HrRequestStatus" AS ENUM ('DRAFT', 'PENDING_MANAGER', 'PENDING_HR', 'INFORMATION_REQUIRED', 'AUTHORIZED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrApprovalRoute" AS ENUM ('MANAGER_THEN_HR', 'HR_DIRECT');

-- CreateEnum
CREATE TYPE "HrApprovalStage" AS ENUM ('MANAGER', 'HR');

-- CreateEnum
CREATE TYPE "HrDecisionType" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_INFORMATION');

-- CreateEnum
CREATE TYPE "HrRequestEventType" AS ENUM ('CREATED', 'SUBMITTED', 'UPDATED', 'INFORMATION_PROVIDED', 'DECISION_RECORDED', 'AUTHORIZED', 'REJECTED', 'CANCELLED', 'TIME_MOVEMENT_CREATED', 'DOCUMENT_UPLOADED');

-- AlterTable
ALTER TABLE "EmployeeTimeMovement" ADD COLUMN     "hrRequestId" TEXT;

-- CreateTable
CREATE TABLE "HrRequest" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "HrRequestType" NOT NULL,
    "status" "HrRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "approvalRoute" "HrApprovalRoute" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "startTime" TEXT,
    "endTime" TEXT,
    "requestedDays" DECIMAL(6,2),
    "requestedMinutes" INTEGER,
    "reason" TEXT NOT NULL,
    "employeeComment" TEXT,
    "submittedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrRequestDecision" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "stage" "HrApprovalStage" NOT NULL,
    "decision" "HrDecisionType" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrRequestDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrRequestEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "eventType" "HrRequestEventType" NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrRequestAttachment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrRequestAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacationBalance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "entitledDays" DECIMAL(6,2) NOT NULL,
    "carriedOverDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "adjustmentDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VacationBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrRequest_folio_key" ON "HrRequest"("folio");

-- CreateIndex
CREATE INDEX "HrRequest_employeeId_createdAt_idx" ON "HrRequest"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "HrRequest_status_createdAt_idx" ON "HrRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "HrRequest_type_startDate_idx" ON "HrRequest"("type", "startDate");

-- CreateIndex
CREATE INDEX "HrRequest_approvalRoute_status_idx" ON "HrRequest"("approvalRoute", "status");

-- CreateIndex
CREATE INDEX "HrRequestDecision_requestId_createdAt_idx" ON "HrRequestDecision"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "HrRequestDecision_actorId_createdAt_idx" ON "HrRequestDecision"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "HrRequestDecision_stage_decision_idx" ON "HrRequestDecision"("stage", "decision");

-- CreateIndex
CREATE INDEX "HrRequestEvent_requestId_createdAt_idx" ON "HrRequestEvent"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "HrRequestEvent_actorId_createdAt_idx" ON "HrRequestEvent"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrRequestAttachment_storageKey_key" ON "HrRequestAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "HrRequestAttachment_requestId_createdAt_idx" ON "HrRequestAttachment"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "VacationBalance_employeeId_periodEnd_idx" ON "VacationBalance"("employeeId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "VacationBalance_employeeId_periodStart_key" ON "VacationBalance"("employeeId", "periodStart");

-- CreateIndex
CREATE INDEX "EmployeeTimeMovement_hrRequestId_idx" ON "EmployeeTimeMovement"("hrRequestId");

-- AddForeignKey
ALTER TABLE "EmployeeTimeMovement" ADD CONSTRAINT "EmployeeTimeMovement_hrRequestId_fkey" FOREIGN KEY ("hrRequestId") REFERENCES "HrRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrRequest" ADD CONSTRAINT "HrRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrRequestDecision" ADD CONSTRAINT "HrRequestDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HrRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrRequestDecision" ADD CONSTRAINT "HrRequestDecision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrRequestEvent" ADD CONSTRAINT "HrRequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HrRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrRequestEvent" ADD CONSTRAINT "HrRequestEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrRequestAttachment" ADD CONSTRAINT "HrRequestAttachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HrRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacationBalance" ADD CONSTRAINT "VacationBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
