-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "pinMustChange" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pinUpdatedAt" TIMESTAMP(3);
