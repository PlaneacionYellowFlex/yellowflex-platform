-- CreateEnum
CREATE TYPE "EmployeeMovementType" AS ENUM ('HIRE', 'POSITION_CHANGE', 'DEPARTMENT_CHANGE', 'SHIFT_CHANGE', 'PROMOTION', 'TERMINATION', 'REHIRE');

-- CreateTable
CREATE TABLE "EmployeeMovement" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "EmployeeMovementType" NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "previousStatus" "EmployeeStatus",
    "newStatus" "EmployeeStatus",
    "previousPosition" TEXT,
    "newPosition" TEXT,
    "previousDepartmentId" TEXT,
    "previousDepartmentCode" TEXT,
    "previousDepartmentName" TEXT,
    "newDepartmentId" TEXT,
    "newDepartmentCode" TEXT,
    "newDepartmentName" TEXT,
    "previousWorkShiftId" TEXT,
    "previousWorkShiftCode" TEXT,
    "previousWorkShiftName" TEXT,
    "newWorkShiftId" TEXT,
    "newWorkShiftCode" TEXT,
    "newWorkShiftName" TEXT,
    "registeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeMovement_employeeId_effectiveDate_idx" ON "EmployeeMovement"("employeeId", "effectiveDate");

-- CreateIndex
CREATE INDEX "EmployeeMovement_type_effectiveDate_idx" ON "EmployeeMovement"("type", "effectiveDate");

-- CreateIndex
CREATE INDEX "EmployeeMovement_effectiveDate_idx" ON "EmployeeMovement"("effectiveDate");

-- CreateIndex
CREATE INDEX "EmployeeMovement_registeredById_idx" ON "EmployeeMovement"("registeredById");

-- AddForeignKey
ALTER TABLE "EmployeeMovement" ADD CONSTRAINT "EmployeeMovement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeMovement" ADD CONSTRAINT "EmployeeMovement_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
