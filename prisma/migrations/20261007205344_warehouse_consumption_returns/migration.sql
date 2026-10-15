-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InventoryCustodyEventType" ADD VALUE 'CONSUMED';
ALTER TYPE "InventoryCustodyEventType" ADD VALUE 'RETURN_REQUESTED';

-- AlterEnum
ALTER TYPE "InventoryCustodyStatus" ADD VALUE 'RETURN_IN_TRANSIT';
