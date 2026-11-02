ALTER TABLE "WarehousePermission" ADD COLUMN "canManageAdjustmentPermissions" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "WarehousePermissionAudit" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "oldValue" BOOLEAN NOT NULL,
  "newValue" BOOLEAN NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WarehousePermissionAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WarehousePermissionAudit_targetUserId_createdAt_idx" ON "WarehousePermissionAudit"("targetUserId", "createdAt");
CREATE INDEX "WarehousePermissionAudit_actorId_createdAt_idx" ON "WarehousePermissionAudit"("actorId", "createdAt");
ALTER TABLE "WarehousePermissionAudit" ADD CONSTRAINT "WarehousePermissionAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehousePermissionAudit" ADD CONSTRAINT "WarehousePermissionAudit_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
