/*
  Warnings:

  - A unique constraint covering the columns `[corporateUserId]` on the table `Employee` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "corporateUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Employee_corporateUserId_key" ON "Employee"("corporateUserId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_corporateUserId_fkey" FOREIGN KEY ("corporateUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
