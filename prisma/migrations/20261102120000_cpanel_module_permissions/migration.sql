-- C-PANEL: tablas nuevas. No altera tablas operativas de Warehouse ni Compras.
CREATE TABLE "CorporateModulePermission" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "moduleKey" VARCHAR(80) NOT NULL,
  "actionKey" VARCHAR(80) NOT NULL,
  "granted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorporateModulePermission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CorporateModulePermission_userId_moduleKey_actionKey_key"
  ON "CorporateModulePermission"("userId", "moduleKey", "actionKey");
CREATE INDEX "CorporateModulePermission_moduleKey_actionKey_idx"
  ON "CorporateModulePermission"("moduleKey", "actionKey");
ALTER TABLE "CorporateModulePermission"
  ADD CONSTRAINT "CorporateModulePermission_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CorporatePermissionAudit" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "moduleKey" VARCHAR(80) NOT NULL,
  "actionKey" VARCHAR(80) NOT NULL,
  "oldGranted" BOOLEAN,
  "newGranted" BOOLEAN,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorporatePermissionAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CorporatePermissionAudit_targetId_createdAt_idx"
  ON "CorporatePermissionAudit"("targetId", "createdAt");
CREATE INDEX "CorporatePermissionAudit_actorId_createdAt_idx"
  ON "CorporatePermissionAudit"("actorId", "createdAt");
CREATE INDEX "CorporatePermissionAudit_moduleKey_actionKey_createdAt_idx"
  ON "CorporatePermissionAudit"("moduleKey", "actionKey", "createdAt");
ALTER TABLE "CorporatePermissionAudit"
  ADD CONSTRAINT "CorporatePermissionAudit_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorporatePermissionAudit"
  ADD CONSTRAINT "CorporatePermissionAudit_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
