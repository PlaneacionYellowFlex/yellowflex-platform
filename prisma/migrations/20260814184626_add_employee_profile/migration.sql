-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('INDEFINITE', 'FIXED_TERM', 'TEMPORARY', 'TRAINING', 'OTHER');

-- CreateTable
CREATE TABLE "EmployeeProfile" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "birthDate" DATE,
    "hireDate" DATE,
    "directManager" TEXT,
    "contractType" "ContractType",
    "phone" TEXT,
    "email" TEXT,
    "terminationDate" DATE,
    "terminationReason" TEXT,
    "transportRoute" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeProfile_employeeId_key" ON "EmployeeProfile"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeProfile_hireDate_idx" ON "EmployeeProfile"("hireDate");

-- CreateIndex
CREATE INDEX "EmployeeProfile_contractType_idx" ON "EmployeeProfile"("contractType");

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
