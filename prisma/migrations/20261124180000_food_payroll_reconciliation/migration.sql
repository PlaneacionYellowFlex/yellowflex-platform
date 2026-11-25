-- YF-002-C2 — Conciliación, ajustes y cierre definitivo de la prenómina de Food Services.
-- Migración INCREMENTAL: no modifica 20261124130000_food_payroll_core. Amplía las tablas de conciliación y
-- ajustes (creadas sin uso en el Bloque A), agrega el resultado por colaborador, nuevas restricciones CHECK,
-- índices únicos parciales y guardas de estado. Las funciones de guarda del lote y de FoodOrder se reemplazan
-- con CREATE OR REPLACE conservando todas sus reglas anteriores; solo se agregan las transiciones legítimas
-- de conciliación y la liquidación del estado de nómina respaldada por evidencia real.
-- Política de saldos: la diferencia se mantiene a nivel colaborador. No se atribuyen pagos parciales a pedidos
-- individuales; un pedido solo pasa a PROCESSED cuando el colaborador queda cubierto por completo.
BEGIN;

-- ------------------------------------------------------------------ precondición: tablas sin uso previo
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "FoodPayrollReconciliation") OR EXISTS (SELECT 1 FROM "FoodPayrollReconciliationItem")
     OR EXISTS (SELECT 1 FROM "FoodPayrollAdjustment") THEN
    RAISE EXCEPTION 'YF_PAYROLL_C2: existen conciliaciones o ajustes previos; estado inesperado.';
  END IF;
  IF EXISTS (SELECT 1 FROM "FoodPayrollBatch" WHERE "status" IN ('PARTIALLY_RECONCILED', 'RECONCILED')) THEN
    RAISE EXCEPTION 'YF_PAYROLL_C2: existen lotes conciliados sin conciliación registrada; estado inesperado.';
  END IF;
END $$;

-- ------------------------------------------------------------------ enums
-- Valores nuevos de auditoría: no se usan dentro de esta misma transacción (PostgreSQL 12+).
ALTER TYPE "FoodPayrollAuditEventType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_REJECTED';
ALTER TYPE "FoodPayrollAuditEventType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_REPLAYED';
ALTER TYPE "FoodPayrollAuditEventType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_VOIDED';
ALTER TYPE "FoodPayrollAuditEventType" ADD VALUE IF NOT EXISTS 'BATCH_RECONCILED';
ALTER TYPE "FoodPayrollAuditEventType" ADD VALUE IF NOT EXISTS 'ADJUSTMENT_RESOLVED';
ALTER TYPE "FoodPayrollAuditEventType" ADD VALUE IF NOT EXISTS 'CONTROL_EXPORTED';

CREATE TYPE "FoodPayrollReconciliationResult" AS ENUM ('COMPLETE', 'PARTIAL', 'NOT_APPLIED', 'OVER_APPLIED');
CREATE TYPE "FoodPayrollAdjustmentKind" AS ENUM ('NOT_APPLIED', 'PARTIAL', 'OVER_APPLIED');
CREATE TYPE "FoodPayrollAdjustmentResolution" AS ENUM ('RECOVERED', 'REFUNDED', 'COMPENSATED', 'CORRECTED', 'WAIVED');

-- ------------------------------------------------------------------ lote: cierre administrativo
ALTER TABLE "FoodPayrollBatch"
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "closedById" TEXT,
  ADD COLUMN "closeNote" VARCHAR(500);

-- ------------------------------------------------------------------ conciliación (una vigente por lote)
ALTER TABLE "FoodPayrollReconciliation"
  ADD COLUMN "idempotencyKey" VARCHAR(120) NOT NULL,
  ADD COLUMN "requestHash" CHAR(64) NOT NULL,
  ADD COLUMN "idempotencyResponse" JSONB NOT NULL,
  ADD COLUMN "contractVersion" INTEGER NOT NULL,
  ADD COLUMN "payrollReference" VARCHAR(40) NOT NULL,
  ADD COLUMN "previewDigest" CHAR(64) NOT NULL,
  ADD COLUMN "fileName" VARCHAR(255) NOT NULL,
  ADD COLUMN "expectedAmount" DECIMAL(12,2) NOT NULL,
  ADD COLUMN "pendingRefundAmount" DECIMAL(12,2) NOT NULL,
  ADD COLUMN "employeeCount" INTEGER NOT NULL,
  ADD COLUMN "completeCount" INTEGER NOT NULL,
  ADD COLUMN "partialCount" INTEGER NOT NULL,
  ADD COLUMN "notAppliedCount" INTEGER NOT NULL,
  ADD COLUMN "overCount" INTEGER NOT NULL,
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedById" TEXT,
  ADD COLUMN "voidReason" VARCHAR(500);
ALTER TABLE "FoodPayrollReconciliation"
  ALTER COLUMN "evidenceSha256" SET NOT NULL,
  ALTER COLUMN "evidenceContent" SET NOT NULL;

-- ------------------------------------------------------------------ resultado por colaborador (evidencia aplicada)
CREATE TABLE "FoodPayrollReconciliationEmployee" (
  "id" TEXT NOT NULL,
  "reconciliationId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "employeeNumber" VARCHAR(80) NOT NULL,
  "employeeName" VARCHAR(200) NOT NULL,
  "orderCount" INTEGER NOT NULL,
  "expectedAmount" DECIMAL(12,2) NOT NULL,
  "appliedAmount" DECIMAL(12,2) NOT NULL,
  "differenceAmount" DECIMAL(12,2) NOT NULL,
  "result" "FoodPayrollReconciliationResult" NOT NULL,
  "sourceRow" INTEGER NOT NULL,
  "note" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FoodPayrollReconciliationEmployee_pkey" PRIMARY KEY ("id")
);

-- ------------------------------------------------------------------ ajustes por colaborador (trazables)
ALTER TABLE "FoodPayrollAdjustment"
  ALTER COLUMN "batchItemId" DROP NOT NULL,
  ALTER COLUMN "orderId" DROP NOT NULL,
  ADD COLUMN "reconciliationId" TEXT NOT NULL,
  ADD COLUMN "reconciliationEmployeeId" TEXT NOT NULL,
  ADD COLUMN "employeeId" TEXT NOT NULL,
  ADD COLUMN "employeeNumber" VARCHAR(80) NOT NULL,
  ADD COLUMN "employeeName" VARCHAR(200) NOT NULL,
  ADD COLUMN "kind" "FoodPayrollAdjustmentKind" NOT NULL,
  ADD COLUMN "balanceAmount" DECIMAL(12,2) NOT NULL,
  ADD COLUMN "parentAdjustmentId" TEXT,
  ADD COLUMN "resolutionType" "FoodPayrollAdjustmentResolution",
  ADD COLUMN "resolvedAmount" DECIMAL(12,2),
  ADD COLUMN "resolutionReference" VARCHAR(160),
  ADD COLUMN "resolutionNote" VARCHAR(1000),
  ADD COLUMN "resolvedById" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedById" TEXT,
  ADD COLUMN "voidReason" VARCHAR(500);

-- ------------------------------------------------------------------ índices (nomenclatura Prisma)
CREATE UNIQUE INDEX "FoodPayrollReconciliation_idempotencyKey_key" ON "FoodPayrollReconciliation"("idempotencyKey");
CREATE INDEX "FoodPayrollReconciliation_batchId_voidedAt_idx" ON "FoodPayrollReconciliation"("batchId", "voidedAt");

CREATE UNIQUE INDEX "FoodPayrollReconEmployee_recon_employee_key" ON "FoodPayrollReconciliationEmployee"("reconciliationId", "employeeId");
CREATE UNIQUE INDEX "FoodPayrollReconEmployee_recon_number_key" ON "FoodPayrollReconciliationEmployee"("reconciliationId", "employeeNumber");
CREATE UNIQUE INDEX "FoodPayrollReconEmployee_id_recon_batch_key" ON "FoodPayrollReconciliationEmployee"("id", "reconciliationId", "batchId");
CREATE INDEX "FoodPayrollReconciliationEmployee_reconciliationId_result_idx" ON "FoodPayrollReconciliationEmployee"("reconciliationId", "result");
CREATE INDEX "FoodPayrollReconciliationEmployee_batchId_employeeId_idx" ON "FoodPayrollReconciliationEmployee"("batchId", "employeeId");
CREATE INDEX "FoodPayrollReconciliationEmployee_employeeId_idx" ON "FoodPayrollReconciliationEmployee"("employeeId");

CREATE INDEX "FoodPayrollAdjustment_reconciliationId_employeeId_status_idx" ON "FoodPayrollAdjustment"("reconciliationId", "employeeId", "status");
CREATE INDEX "FoodPayrollAdjustment_reconciliationEmployeeId_idx" ON "FoodPayrollAdjustment"("reconciliationEmployeeId");
CREATE INDEX "FoodPayrollAdjustment_employeeId_status_idx" ON "FoodPayrollAdjustment"("employeeId", "status");

-- Barreras contra conciliaciones duplicadas y bifurcaciones de saldo.
CREATE UNIQUE INDEX "FoodPayrollReconciliation_one_active_per_batch"
  ON "FoodPayrollReconciliation"("batchId") WHERE "voidedAt" IS NULL;
CREATE UNIQUE INDEX "FoodPayrollAdjustment_one_root_per_employee"
  ON "FoodPayrollAdjustment"("reconciliationEmployeeId") WHERE "parentAdjustmentId" IS NULL;
CREATE UNIQUE INDEX "FoodPayrollAdjustment_one_successor"
  ON "FoodPayrollAdjustment"("parentAdjustmentId") WHERE "parentAdjustmentId" IS NOT NULL;

-- ------------------------------------------------------------------ integridad referencial
ALTER TABLE "FoodPayrollBatch" ADD CONSTRAINT "FoodPayrollBatch_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollReconciliation" ADD CONSTRAINT "FoodPayrollReconciliation_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FoodPayrollReconciliationEmployee" ADD CONSTRAINT "FoodPayrollReconciliationEmployee_reconciliationId_batchId_fkey" FOREIGN KEY ("reconciliationId", "batchId") REFERENCES "FoodPayrollReconciliation"("id", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollReconciliationEmployee" ADD CONSTRAINT "FoodPayrollReconciliationEmployee_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FoodPayrollBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollReconciliationEmployee" ADD CONSTRAINT "FoodPayrollReconciliationEmployee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FoodPayrollAdjustment" ADD CONSTRAINT "FoodPayrollAdjustment_recon_employee_fkey" FOREIGN KEY ("reconciliationEmployeeId", "reconciliationId", "batchId") REFERENCES "FoodPayrollReconciliationEmployee"("id", "reconciliationId", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollAdjustment" ADD CONSTRAINT "FoodPayrollAdjustment_reconciliationId_batchId_fkey" FOREIGN KEY ("reconciliationId", "batchId") REFERENCES "FoodPayrollReconciliation"("id", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollAdjustment" ADD CONSTRAINT "FoodPayrollAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollAdjustment" ADD CONSTRAINT "FoodPayrollAdjustment_parentAdjustmentId_fkey" FOREIGN KEY ("parentAdjustmentId") REFERENCES "FoodPayrollAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollAdjustment" ADD CONSTRAINT "FoodPayrollAdjustment_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollAdjustment" ADD CONSTRAINT "FoodPayrollAdjustment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------ CHECK: importes exactos y coherencia
ALTER TABLE "FoodPayrollBatch"
  ADD CONSTRAINT "FoodPayrollBatch_close_chk" CHECK (
    ("status" = 'RECONCILED' AND "closedAt" IS NOT NULL AND "closedById" IS NOT NULL)
    OR ("status" <> 'RECONCILED' AND "closedAt" IS NULL AND "closedById" IS NULL AND "closeNote" IS NULL));

ALTER TABLE "FoodPayrollReconciliation"
  ADD CONSTRAINT "FoodPayrollReconciliation_values_chk" CHECK (
    "expectedAmount" > 0 AND "receivedAmount" >= 0 AND "reconciledAmount" >= 0
    AND "reconciledAmount" <= "expectedAmount" AND "reconciledAmount" <= "receivedAmount"
    AND "unreconciledAmount" = "expectedAmount" - "reconciledAmount"
    AND "pendingRefundAmount" = "receivedAmount" - "reconciledAmount"
    AND "employeeCount" > 0 AND "completeCount" >= 0 AND "partialCount" >= 0 AND "notAppliedCount" >= 0 AND "overCount" >= 0
    AND "employeeCount" = "completeCount" + "partialCount" + "notAppliedCount" + "overCount"
    AND (("unreconciledAmount" = 0) = ("partialCount" + "notAppliedCount" = 0))
    AND (("pendingRefundAmount" = 0) = ("overCount" = 0))),
  ADD CONSTRAINT "FoodPayrollReconciliation_identity_chk" CHECK (
    char_length("idempotencyKey") BETWEEN 8 AND 120 AND "requestHash" ~ '^[0-9a-f]{64}$' AND "previewDigest" ~ '^[0-9a-f]{64}$'
    AND "evidenceSha256" ~ '^[0-9a-f]{64}$' AND "contractVersion" > 0 AND btrim("fileName") <> ''
    AND "payrollReference" = btrim("payrollReference") AND char_length("payrollReference") BETWEEN 1 AND 40),
  ADD CONSTRAINT "FoodPayrollReconciliation_lifecycle_chk" CHECK (
    ("status" = 'RECEIVED' AND "closedAt" IS NULL)
    OR ("status" IN ('PARTIALLY_RECONCILED', 'RECONCILED') AND "closedAt" IS NOT NULL AND "voidedAt" IS NULL
        AND (("status" = 'RECONCILED') = ("completeCount" = "employeeCount")))),
  ADD CONSTRAINT "FoodPayrollReconciliation_void_chk" CHECK (
    ("voidedAt" IS NULL AND "voidedById" IS NULL AND "voidReason" IS NULL)
    OR ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND char_length(btrim(coalesce("voidReason", ''))) >= 10));

ALTER TABLE "FoodPayrollReconciliationEmployee"
  ADD CONSTRAINT "FoodPayrollReconciliationEmployee_values_chk" CHECK (
    "orderCount" > 0 AND "expectedAmount" > 0 AND "appliedAmount" >= 0 AND "sourceRow" >= 2
    AND "differenceAmount" = "appliedAmount" - "expectedAmount" AND btrim("employeeNumber") <> ''
    AND (("result" = 'COMPLETE' AND "appliedAmount" = "expectedAmount")
      OR ("result" = 'NOT_APPLIED' AND "appliedAmount" = 0)
      OR ("result" = 'PARTIAL' AND "appliedAmount" > 0 AND "appliedAmount" < "expectedAmount")
      OR ("result" = 'OVER_APPLIED' AND "appliedAmount" > "expectedAmount")));

ALTER TABLE "FoodPayrollAdjustment"
  -- Sin atribución a pedidos individuales: el saldo vive a nivel colaborador.
  ADD CONSTRAINT "FoodPayrollAdjustment_scope_chk" CHECK ("batchItemId" IS NULL AND "orderId" IS NULL),
  ADD CONSTRAINT "FoodPayrollAdjustment_amounts_chk" CHECK (
    "originalAmount" > 0 AND "adjustedAmount" >= 0 AND "differenceAmount" = "adjustedAmount" - "originalAmount"
    AND char_length(btrim("reason")) >= 5
    AND (("kind" = 'NOT_APPLIED' AND "adjustedAmount" = 0)
      OR ("kind" = 'PARTIAL' AND "adjustedAmount" > 0 AND "adjustedAmount" < "originalAmount")
      OR ("kind" = 'OVER_APPLIED' AND "adjustedAmount" > "originalAmount"))
    AND (("kind" IN ('NOT_APPLIED', 'PARTIAL') AND "balanceAmount" > 0 AND "balanceAmount" <= -"differenceAmount")
      OR ("kind" = 'OVER_APPLIED' AND "balanceAmount" < 0 AND "balanceAmount" >= -"differenceAmount"))),
  ADD CONSTRAINT "FoodPayrollAdjustment_lifecycle_chk" CHECK (
    ("status" = 'PENDING' AND "resolutionType" IS NULL AND "resolvedAmount" IS NULL AND "resolvedById" IS NULL AND "appliedAt" IS NULL
      AND "resolutionReference" IS NULL AND "resolutionNote" IS NULL AND "voidedAt" IS NULL AND "voidedById" IS NULL AND "voidReason" IS NULL)
    OR ("status" = 'APPLIED' AND "resolutionType" IS NOT NULL AND "resolvedAmount" > 0 AND "resolvedAmount" <= abs("balanceAmount")
      AND "resolvedById" IS NOT NULL AND "appliedAt" IS NOT NULL AND char_length(btrim(coalesce("resolutionNote", ''))) >= 10
      AND "voidedAt" IS NULL AND "voidedById" IS NULL AND "voidReason" IS NULL
      AND (("kind" IN ('NOT_APPLIED', 'PARTIAL') AND "resolutionType" IN ('RECOVERED', 'CORRECTED', 'WAIVED'))
        OR ("kind" = 'OVER_APPLIED' AND "resolutionType" IN ('REFUNDED', 'COMPENSATED', 'CORRECTED')))
      AND ("resolutionType" NOT IN ('CORRECTED', 'WAIVED') OR "resolvedAmount" = abs("balanceAmount"))
      AND ("resolutionType" = 'WAIVED' OR char_length(btrim(coalesce("resolutionReference", ''))) >= 3))
    OR ("status" = 'VOIDED' AND "voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND char_length(btrim(coalesce("voidReason", ''))) >= 10
      AND "resolutionType" IS NULL AND "resolvedAmount" IS NULL AND "resolvedById" IS NULL AND "appliedAt" IS NULL));

-- ------------------------------------------------------------------ cobertura real por colaborador
-- Un colaborador está cubierto cuando Nómina aplicó al menos lo esperado o cuando todos sus saldos por
-- recuperar quedaron resueltos como recuperados o corregidos (sin pendientes ni condonaciones).
CREATE FUNCTION "food_payroll_employee_covered"(p_batch text, p_employee text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "FoodPayrollReconciliation" r
    JOIN "FoodPayrollReconciliationEmployee" e ON e."reconciliationId" = r."id" AND e."employeeId" = p_employee
    WHERE r."batchId" = p_batch AND r."voidedAt" IS NULL AND r."status" <> 'RECEIVED'
      AND (e."result" IN ('COMPLETE', 'OVER_APPLIED')
        OR NOT EXISTS (SELECT 1 FROM "FoodPayrollAdjustment" a WHERE a."reconciliationEmployeeId" = e."id"
             AND (a."status" = 'PENDING' OR (a."status" = 'APPLIED' AND a."resolutionType" = 'WAIVED')))))
$$;

-- ------------------------------------------------------------------ triggers: lote (reemplazo conservador)
-- Se conservan todas las reglas del Bloque A. Cambios: EXPORTED -> RECONCILED directo deja de permitirse
-- (requiere conciliación registrada), se agrega PARTIALLY_RECONCILED -> EXPORTED (solo si la conciliación se
-- anuló) y cada transición de conciliación valida en base de datos la evidencia completa.
CREATE OR REPLACE FUNCTION "food_payroll_batch_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o "FoodPayrollBatch"; n "FoodPayrollBatch"; r "FoodPayrollReconciliation";
  c_items integer; c_emp integer; c_srv integer; c_amt numeric; c_svc_rows integer; c_assign integer;
  e_rows integer; e_exp numeric; e_app numeric; e_cov numeric; e_comp integer; e_part integer; e_none integer; e_over integer; a_roots integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "food_payroll_qa_fixture_cleanup"(OLD."id") THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: los lotes de prenomina no se eliminan (%).', OLD."id";
  END IF;
  o := OLD; n := NEW;
  -- Identidad e idempotencia: inmutables siempre.
  IF n."id" <> o."id" OR n."idempotencyKey" <> o."idempotencyKey" OR n."idempotencyRequestHash" <> o."idempotencyRequestHash"
     OR n."contractVersion" <> o."contractVersion" OR n."payrollReference" <> o."payrollReference" OR n."previewDigest" <> o."previewDigest"
     OR n."currency" <> o."currency" OR n."createdById" <> o."createdById" OR n."createdAt" <> o."createdAt" THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: identidad, referencia e idempotencia del lote son inmutables.';
  END IF;
  IF o."status" = 'DRAFT' THEN
    IF n."status" NOT IN ('DRAFT', 'GENERATED') THEN
      RAISE EXCEPTION 'YF_PAYROLL_GUARD: transicion no permitida % -> %.', o."status", n."status";
    END IF;
    IF n."status" = 'GENERATED' THEN
      SELECT count(*), count(DISTINCT "employeeId"), coalesce(sum("itemCount"), 0), coalesce(sum("committedAmount"), 0)
        INTO c_items, c_emp, c_srv, c_amt FROM "FoodPayrollBatchItem" WHERE "batchId" = n."id";
      SELECT count(*) INTO c_svc_rows FROM "FoodPayrollBatchItemService" WHERE "batchId" = n."id";
      SELECT count(*) INTO c_assign FROM "FoodPayrollAssignment" WHERE "batchId" = n."id" AND "status" = 'ACTIVE';
      IF c_items = 0 OR c_items <> n."orderCount" OR c_emp <> n."employeeCount" OR c_srv <> n."serviceCount"
         OR c_amt <> n."committedAmount" OR c_svc_rows <> n."serviceCount" OR c_assign <> c_items THEN
        RAISE EXCEPTION 'YF_PAYROLL_GUARD: totales del lote no coinciden con detalles, servicios y asignaciones.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- Fuera de DRAFT: totales, respuesta y generación congelados.
  IF n."orderCount" <> o."orderCount" OR n."employeeCount" <> o."employeeCount" OR n."serviceCount" <> o."serviceCount"
     OR n."committedAmount" <> o."committedAmount" OR n."generatedAt" IS DISTINCT FROM o."generatedAt"
     OR n."idempotencyResponse" IS DISTINCT FROM o."idempotencyResponse" THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: los totales y la respuesta de un lote generado son inmutables.';
  END IF;
  -- Metadatos de exportación y anulación: se fijan una sola vez.
  IF o."exportedAt" IS NOT NULL AND (n."exportedAt" IS DISTINCT FROM o."exportedAt" OR n."exportedById" IS DISTINCT FROM o."exportedById"
     OR n."fileName" IS DISTINCT FROM o."fileName" OR n."fileSha256" IS DISTINCT FROM o."fileSha256" OR n."fileContent" IS DISTINCT FROM o."fileContent"
     OR n."externalReference" IS DISTINCT FROM o."externalReference") THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: la exportacion oficial registrada es inmutable.';
  END IF;
  IF o."status" = 'VOIDED' OR o."status" = 'RECONCILED' THEN
    o."updatedAt" := n."updatedAt";
    IF row(n.*) IS DISTINCT FROM row(o.*) THEN
      RAISE EXCEPTION 'YF_PAYROLL_GUARD: un lote % es definitivo.', o."status";
    END IF;
    RETURN NEW;
  END IF;
  IF n."status" <> o."status" AND NOT (
       (o."status" = 'GENERATED' AND n."status" IN ('EXPORTED', 'VOIDED'))
    OR (o."status" = 'EXPORTED' AND n."status" = 'PARTIALLY_RECONCILED')
    OR (o."status" = 'PARTIALLY_RECONCILED' AND n."status" IN ('RECONCILED', 'EXPORTED'))) THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: transicion no permitida % -> %.', o."status", n."status";
  END IF;
  IF n."status" <> o."status" AND n."status" IN ('PARTIALLY_RECONCILED', 'RECONCILED', 'EXPORTED') AND o."status" IN ('EXPORTED', 'PARTIALLY_RECONCILED') THEN
    SELECT * INTO r FROM "FoodPayrollReconciliation" WHERE "batchId" = n."id" AND "voidedAt" IS NULL;
    IF n."status" = 'EXPORTED' THEN
      -- Regreso a EXPORTED: únicamente cuando la conciliación vigente fue anulada.
      IF FOUND THEN RAISE EXCEPTION 'YF_PAYROLL_GUARD: el lote conserva una conciliacion vigente.'; END IF;
      RETURN NEW;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'YF_PAYROLL_GUARD: se requiere una conciliacion vigente.'; END IF;
    IF n."status" = 'PARTIALLY_RECONCILED' THEN
      -- Registro de conciliación: cada colaborador del lote con su importe aplicado y cada diferencia con su ajuste.
      IF r."status" <> 'RECEIVED' OR r."employeeCount" <> n."employeeCount" OR r."expectedAmount" <> n."committedAmount" THEN
        RAISE EXCEPTION 'YF_PAYROLL_GUARD: la conciliacion no corresponde al lote.';
      END IF;
      SELECT count(*), coalesce(sum("expectedAmount"), 0), coalesce(sum("appliedAmount"), 0), coalesce(sum(least("appliedAmount", "expectedAmount")), 0),
             count(*) FILTER (WHERE "result" = 'COMPLETE'), count(*) FILTER (WHERE "result" = 'PARTIAL'),
             count(*) FILTER (WHERE "result" = 'NOT_APPLIED'), count(*) FILTER (WHERE "result" = 'OVER_APPLIED')
        INTO e_rows, e_exp, e_app, e_cov, e_comp, e_part, e_none, e_over
        FROM "FoodPayrollReconciliationEmployee" WHERE "reconciliationId" = r."id";
      IF e_rows <> n."employeeCount" OR e_exp <> n."committedAmount" OR e_app <> r."receivedAmount" OR e_cov <> r."reconciledAmount"
         OR e_comp <> r."completeCount" OR e_part <> r."partialCount" OR e_none <> r."notAppliedCount" OR e_over <> r."overCount" THEN
        RAISE EXCEPTION 'YF_PAYROLL_GUARD: la conciliacion no cubre a todos los colaboradores del lote o sus totales no cuadran.';
      END IF;
      SELECT count(*) INTO a_roots FROM "FoodPayrollAdjustment" a JOIN "FoodPayrollReconciliationEmployee" e ON e."id" = a."reconciliationEmployeeId"
        WHERE a."reconciliationId" = r."id" AND a."parentAdjustmentId" IS NULL AND a."status" = 'PENDING' AND a."balanceAmount" = -e."differenceAmount";
      IF a_roots <> e_part + e_none + e_over
         OR (SELECT count(*) FROM "FoodPayrollAdjustment" WHERE "reconciliationId" = r."id") <> a_roots THEN
        RAISE EXCEPTION 'YF_PAYROLL_GUARD: cada diferencia debe quedar registrada como ajuste trazable.';
      END IF;
    ELSE
      -- Cierre definitivo: conciliación cerrada en la misma operación; las diferencias permanecen como ajustes.
      IF r."status" = 'RECEIVED' OR r."closedAt" IS NULL THEN
        RAISE EXCEPTION 'YF_PAYROLL_GUARD: la conciliacion debe cerrarse junto con el lote.';
      END IF;
      IF EXISTS (SELECT 1 FROM "FoodPayrollReconciliationEmployee" e WHERE e."reconciliationId" = r."id" AND e."result" <> 'COMPLETE'
                 AND NOT EXISTS (SELECT 1 FROM "FoodPayrollAdjustment" a WHERE a."reconciliationEmployeeId" = e."id" AND a."parentAdjustmentId" IS NULL AND a."status" <> 'VOIDED')) THEN
        RAISE EXCEPTION 'YF_PAYROLL_GUARD: una diferencia no tiene ajuste vigente; el cierre no puede ocultarla.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------------ triggers: FoodOrder (reemplazo conservador)
-- Se conserva el bloqueo del Bloque A. Única excepción: el estado de nómina de un pedido de un lote RECONCILED
-- pasa a PROCESSED solo si el colaborador quedó cubierto por evidencia, o a EXPORTED si no lo está.
CREATE OR REPLACE FUNCTION "food_order_payroll_assignment_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a_batch text;
BEGIN
  SELECT "batchId" INTO a_batch FROM "FoodPayrollAssignment" WHERE "orderId" = OLD."id" AND "status" = 'ACTIVE';
  IF a_batch IS NOT NULL AND (
       NEW."status" <> OLD."status" OR NEW."payrollStatus" <> OLD."payrollStatus" OR NEW."employeeId" <> OLD."employeeId"
    OR NEW."menuWeekId" <> OLD."menuWeekId" OR NEW."itemCount" <> OLD."itemCount"
    OR NEW."unitPrice" <> OLD."unitPrice" OR NEW."totalAmount" <> OLD."totalAmount") THEN
    IF NEW."status" = OLD."status" AND NEW."employeeId" = OLD."employeeId" AND NEW."menuWeekId" = OLD."menuWeekId"
       AND NEW."itemCount" = OLD."itemCount" AND NEW."unitPrice" = OLD."unitPrice" AND NEW."totalAmount" = OLD."totalAmount"
       AND EXISTS (SELECT 1 FROM "FoodPayrollBatch" WHERE "id" = a_batch AND "status" = 'RECONCILED') THEN
      IF OLD."payrollStatus" = 'PENDING' AND NEW."payrollStatus" = 'EXPORTED'
         AND NOT "food_payroll_employee_covered"(a_batch, OLD."employeeId") THEN
        RETURN NEW;
      END IF;
      IF OLD."payrollStatus" IN ('PENDING', 'EXPORTED') AND NEW."payrollStatus" = 'PROCESSED'
         AND "food_payroll_employee_covered"(a_batch, OLD."employeeId") THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: el pedido % esta asignado a un lote de prenomina activo.', OLD."id";
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------------ triggers: conciliación
CREATE FUNCTION "food_payroll_reconciliation_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "FoodPayrollBatch"; o "FoodPayrollReconciliation"; n "FoodPayrollReconciliation";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "food_payroll_qa_fixture_cleanup"(OLD."batchId") THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: las conciliaciones no se eliminan.';
  END IF;
  SELECT * INTO b FROM "FoodPayrollBatch" WHERE "id" = NEW."batchId";
  IF TG_OP = 'INSERT' THEN
    IF b."status" IS DISTINCT FROM 'EXPORTED' OR NEW."status" <> 'RECEIVED' OR NEW."closedAt" IS NOT NULL OR NEW."voidedAt" IS NOT NULL
       OR NEW."expectedAmount" <> b."committedAmount" OR NEW."employeeCount" <> b."employeeCount" OR NEW."payrollReference" <> b."payrollReference" THEN
      RAISE EXCEPTION 'YF_PAYROLL_GUARD: conciliacion invalida para el lote %.', NEW."batchId";
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."voidedAt" IS NOT NULL OR OLD."status" <> 'RECEIVED' THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: una conciliacion anulada o cerrada es definitiva.';
  END IF;
  -- Solo cambian el estado de cierre o los datos de anulación; la evidencia registrada es inmutable.
  o := OLD; n := NEW;
  o."status" := n."status"; o."closedAt" := n."closedAt"; o."voidedAt" := n."voidedAt"; o."voidedById" := n."voidedById"; o."voidReason" := n."voidReason";
  IF row(n.*) IS DISTINCT FROM row(o.*) THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: la evidencia de conciliacion registrada es inmutable.';
  END IF;
  IF b."status" <> 'PARTIALLY_RECONCILED' THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: el lote no tiene una conciliacion abierta.';
  END IF;
  IF NEW."voidedAt" IS NOT NULL THEN
    IF NEW."status" <> 'RECEIVED' THEN RAISE EXCEPTION 'YF_PAYROLL_GUARD: no se anula una conciliacion cerrada.'; END IF;
    IF EXISTS (SELECT 1 FROM "FoodPayrollAdjustment" WHERE "reconciliationId" = OLD."id" AND "status" = 'APPLIED') THEN
      RAISE EXCEPTION 'YF_PAYROLL_GUARD: la conciliacion tiene ajustes resueltos; no se anula.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" = 'RECEIVED' THEN RAISE EXCEPTION 'YF_PAYROLL_GUARD: cambio no permitido en la conciliacion.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FoodPayrollReconciliation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FoodPayrollReconciliation"
  FOR EACH ROW EXECUTE FUNCTION "food_payroll_reconciliation_guard"();

CREATE FUNCTION "food_payroll_reconciliation_employee_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "FoodPayrollReconciliation"; b_status "FoodPayrollBatchStatus"; c_items integer; c_amt numeric; c_other integer;
BEGIN
  IF TG_OP = 'DELETE' AND "food_payroll_qa_fixture_cleanup"(OLD."batchId") THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: el resultado conciliado por colaborador es inmutable.';
  END IF;
  SELECT * INTO r FROM "FoodPayrollReconciliation" WHERE "id" = NEW."reconciliationId";
  SELECT "status" INTO b_status FROM "FoodPayrollBatch" WHERE "id" = NEW."batchId";
  IF r."voidedAt" IS NOT NULL OR r."status" <> 'RECEIVED' OR b_status IS DISTINCT FROM 'EXPORTED' THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: solo se registran resultados en una conciliacion nueva.';
  END IF;
  SELECT count(*), coalesce(sum("committedAmount"), 0), count(*) FILTER (WHERE "employeeNumber" <> NEW."employeeNumber")
    INTO c_items, c_amt, c_other FROM "FoodPayrollBatchItem" WHERE "batchId" = NEW."batchId" AND "employeeId" = NEW."employeeId";
  IF c_items = 0 OR c_items <> NEW."orderCount" OR c_amt <> NEW."expectedAmount" OR c_other <> 0 THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: el importe esperado no coincide con el lote para el colaborador %.', NEW."employeeNumber";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FoodPayrollReconciliationEmployee_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FoodPayrollReconciliationEmployee"
  FOR EACH ROW EXECUTE FUNCTION "food_payroll_reconciliation_employee_guard"();

-- Tabla por pedido del Bloque A: sin uso, porque atribuir pagos parciales a pedidos individuales sería falso.
CREATE FUNCTION "food_payroll_reconciliation_item_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND "food_payroll_qa_fixture_cleanup"(OLD."batchId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'YF_PAYROLL_GUARD: la conciliacion se registra por colaborador; no se atribuyen pagos a pedidos individuales.';
END $$;
CREATE TRIGGER "FoodPayrollReconciliationItem_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FoodPayrollReconciliationItem"
  FOR EACH ROW EXECUTE FUNCTION "food_payroll_reconciliation_item_guard"();

-- ------------------------------------------------------------------ triggers: ajustes
CREATE FUNCTION "food_payroll_adjustment_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "FoodPayrollReconciliation"; e "FoodPayrollReconciliationEmployee"; p "FoodPayrollAdjustment";
        b_status "FoodPayrollBatchStatus"; o "FoodPayrollAdjustment"; n "FoodPayrollAdjustment";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "food_payroll_qa_fixture_cleanup"(OLD."batchId") THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: los ajustes no se eliminan.';
  END IF;
  SELECT * INTO r FROM "FoodPayrollReconciliation" WHERE "id" = NEW."reconciliationId";
  SELECT "status" INTO b_status FROM "FoodPayrollBatch" WHERE "id" = NEW."batchId";
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO e FROM "FoodPayrollReconciliationEmployee" WHERE "id" = NEW."reconciliationEmployeeId";
    IF NEW."status" <> 'PENDING' OR r."voidedAt" IS NOT NULL OR e."employeeId" <> NEW."employeeId" OR e."employeeNumber" <> NEW."employeeNumber"
       OR e."expectedAmount" <> NEW."originalAmount" OR e."appliedAmount" <> NEW."adjustedAmount" OR e."differenceAmount" <> NEW."differenceAmount"
       OR e."result"::text <> NEW."kind"::text THEN
      RAISE EXCEPTION 'YF_PAYROLL_GUARD: el ajuste no corresponde al resultado conciliado.';
    END IF;
    IF NEW."parentAdjustmentId" IS NULL THEN
      IF r."status" <> 'RECEIVED' OR b_status IS DISTINCT FROM 'EXPORTED' OR NEW."balanceAmount" <> -NEW."differenceAmount" THEN
        RAISE EXCEPTION 'YF_PAYROLL_GUARD: el ajuste inicial se registra con la conciliacion y por la diferencia completa.';
      END IF;
    ELSE
      SELECT * INTO p FROM "FoodPayrollAdjustment" WHERE "id" = NEW."parentAdjustmentId";
      IF p."status" <> 'APPLIED' OR p."reconciliationEmployeeId" <> NEW."reconciliationEmployeeId"
         OR p."resolutionType" NOT IN ('RECOVERED', 'REFUNDED', 'COMPENSATED') OR p."resolvedAmount" >= abs(p."balanceAmount")
         OR NEW."balanceAmount" <> p."balanceAmount" - sign(p."balanceAmount") * p."resolvedAmount"
         OR b_status NOT IN ('PARTIALLY_RECONCILED', 'RECONCILED') THEN
        RAISE EXCEPTION 'YF_PAYROLL_GUARD: el saldo remanente no corresponde a la resolucion parcial.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: un ajuste resuelto o anulado es definitivo.';
  END IF;
  o := OLD; n := NEW;
  o."status" := n."status"; o."resolutionType" := n."resolutionType"; o."resolvedAmount" := n."resolvedAmount";
  o."resolutionReference" := n."resolutionReference"; o."resolutionNote" := n."resolutionNote"; o."resolvedById" := n."resolvedById";
  o."appliedAt" := n."appliedAt"; o."voidedAt" := n."voidedAt"; o."voidedById" := n."voidedById"; o."voidReason" := n."voidReason";
  IF row(n.*) IS DISTINCT FROM row(o.*) THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: los importes y la identidad del ajuste son inmutables.';
  END IF;
  IF NEW."status" = 'APPLIED' THEN
    IF r."voidedAt" IS NOT NULL OR b_status NOT IN ('PARTIALLY_RECONCILED', 'RECONCILED') THEN
      RAISE EXCEPTION 'YF_PAYROLL_GUARD: el ajuste no puede resolverse en el estado actual del lote.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" = 'VOIDED' THEN
    IF r."voidedAt" IS NULL THEN
      RAISE EXCEPTION 'YF_PAYROLL_GUARD: solo se anulan ajustes de una conciliacion anulada; una diferencia no desaparece.';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'YF_PAYROLL_GUARD: cambio no permitido en el ajuste.';
END $$;
CREATE TRIGGER "FoodPayrollAdjustment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FoodPayrollAdjustment"
  FOR EACH ROW EXECUTE FUNCTION "food_payroll_adjustment_guard"();

COMMIT;
