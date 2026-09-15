-- CreateEnum
CREATE TYPE "EmployeeTimeMovementType" AS ENUM ('DEBT', 'RECOVERY', 'CREDIT_ADJUSTMENT', 'DEBIT_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "EmployeeTimeReason" AS ENUM ('LATE_ARRIVAL', 'ABSENCE', 'EARLY_DEPARTURE', 'PERMISSION', 'OTHER');

-- CreateTable
CREATE TABLE "EmployeeTimeMovement" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "EmployeeTimeMovementType" NOT NULL,
    "reason" "EmployeeTimeReason" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "notes" TEXT,
    "registeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeTimeMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeTimeMovement_employeeId_effectiveDate_idx" ON "EmployeeTimeMovement"("employeeId", "effectiveDate");

-- CreateIndex
CREATE INDEX "EmployeeTimeMovement_employeeId_type_idx" ON "EmployeeTimeMovement"("employeeId", "type");

-- CreateIndex
CREATE INDEX "EmployeeTimeMovement_type_effectiveDate_idx" ON "EmployeeTimeMovement"("type", "effectiveDate");

-- CreateIndex
CREATE INDEX "EmployeeTimeMovement_reason_effectiveDate_idx" ON "EmployeeTimeMovement"("reason", "effectiveDate");

-- CreateIndex
CREATE INDEX "EmployeeTimeMovement_effectiveDate_idx" ON "EmployeeTimeMovement"("effectiveDate");

-- CreateIndex
CREATE INDEX "EmployeeTimeMovement_registeredById_idx" ON "EmployeeTimeMovement"("registeredById");

-- AddForeignKey
ALTER TABLE "EmployeeTimeMovement" ADD CONSTRAINT "EmployeeTimeMovement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTimeMovement" ADD CONSTRAINT "EmployeeTimeMovement_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
