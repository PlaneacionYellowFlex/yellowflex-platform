-- AlterEnum
ALTER TYPE "EmployeeMovementType" ADD VALUE 'MANAGER_CHANGE';

-- AlterTable
ALTER TABLE "EmployeeMovement" ADD COLUMN     "newManagerId" TEXT,
ADD COLUMN     "newManagerName" TEXT,
ADD COLUMN     "newManagerUserId" TEXT,
ADD COLUMN     "previousManagerId" TEXT,
ADD COLUMN     "previousManagerName" TEXT,
ADD COLUMN     "previousManagerUserId" TEXT;

-- AlterTable
ALTER TABLE "EmployeeProfile" ADD COLUMN     "managerUserId" TEXT;

-- CreateIndex
CREATE INDEX "EmployeeProfile_managerUserId_idx" ON "EmployeeProfile"("managerUserId");

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
