/*
  Warnings:

  - You are about to drop the column `directManager` on the `EmployeeProfile` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "EmployeeProfile" DROP COLUMN "directManager",
ADD COLUMN     "managerId" TEXT;

-- CreateIndex
CREATE INDEX "EmployeeProfile_managerId_idx" ON "EmployeeProfile"("managerId");

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
