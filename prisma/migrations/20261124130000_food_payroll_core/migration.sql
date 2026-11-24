-- YF-002 Bloque A: motor de prenómina Food Services.
-- Crea las tablas FoodPayroll* declaradas en schema.prisma (hasta hoy sin migración), el índice único
-- parcial de asignaciones ACTIVE, restricciones CHECK, integridad referencial, coherencia de estados,
-- inmutabilidad de snapshots e historial append-only. No altera datos existentes ni migraciones históricas.
-- Un lote puede contener pedidos de distintas semanas: la semana de servicio vive en cada detalle.
BEGIN;

-- ------------------------------------------------------------------ enums
CREATE TYPE "FoodPayrollBatchStatus" AS ENUM ('DRAFT', 'GENERATED', 'EXPORTED', 'PARTIALLY_RECONCILED', 'RECONCILED', 'VOIDED');
CREATE TYPE "FoodPayrollAssignmentStatus" AS ENUM ('ACTIVE', 'RELEASED');
CREATE TYPE "FoodPayrollReconciliationStatus" AS ENUM ('RECEIVED', 'PARTIALLY_RECONCILED', 'RECONCILED');
CREATE TYPE "FoodPayrollAdjustmentStatus" AS ENUM ('PENDING', 'APPLIED', 'VOIDED');
CREATE TYPE "FoodPayrollAuditEventType" AS ENUM ('BATCH_CREATED', 'BATCH_REPLAYED', 'BATCH_REJECTED', 'BATCH_VOIDED', 'BATCH_EXPORTED', 'ASSIGNMENT_RELEASED', 'RECONCILIATION_RECORDED', 'ADJUSTMENT_RECORDED');

-- ------------------------------------------------------------------ tablas
CREATE TABLE "FoodPayrollBatch" (
  "id" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(120) NOT NULL,
  "idempotencyRequestHash" CHAR(64) NOT NULL,
  "idempotencyResponse" JSONB,
  "contractVersion" INTEGER NOT NULL,
  "status" "FoodPayrollBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "payrollReference" VARCHAR(40) NOT NULL,
  "previewDigest" CHAR(64) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
  "orderCount" INTEGER NOT NULL DEFAULT 0,
  "employeeCount" INTEGER NOT NULL DEFAULT 0,
  "serviceCount" INTEGER NOT NULL DEFAULT 0,
  "committedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "generatedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "exportedAt" TIMESTAMP(3),
  "exportedById" TEXT,
  "externalReference" VARCHAR(160),
  "fileName" VARCHAR(255),
  "fileSha256" VARCHAR(64),
  "fileContent" BYTEA,
  "voidedAt" TIMESTAMP(3),
  "voidedById" TEXT,
  "voidReason" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FoodPayrollBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FoodPayrollBatchItem" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "employeeNumber" VARCHAR(80) NOT NULL,
  "employeeName" VARCHAR(200) NOT NULL,
  "employeeStatusSnapshot" "EmployeeStatus" NOT NULL,
  "inactiveEmployeeReviewed" BOOLEAN NOT NULL DEFAULT false,
  "departmentIdSnapshot" TEXT,
  "departmentCode" VARCHAR(80),
  "departmentName" VARCHAR(200),
  "workShiftIdSnapshot" TEXT,
  "workShiftCode" VARCHAR(80),
  "workShiftName" VARCHAR(200),
  "menuWeekId" TEXT NOT NULL,
  "serviceWeekStart" DATE NOT NULL,
  "orderStatusSnapshot" "FoodOrderStatus" NOT NULL,
  "payrollStatusSnapshot" "FoodOrderPayrollStatus" NOT NULL,
  "confirmedAtSnapshot" TIMESTAMP(3) NOT NULL,
  "orderCreatedAtSnapshot" TIMESTAMP(3) NOT NULL,
  "itemCount" INTEGER NOT NULL,
  "historicalUnitPrice" DECIMAL(10,2) NOT NULL,
  "committedAmount" DECIMAL(12,2) NOT NULL,
  "orderFingerprint" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FoodPayrollBatchItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FoodPayrollBatchItemService" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "batchItemId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "menuItemId" TEXT NOT NULL,
  "serviceDate" DATE NOT NULL,
  "serviceType" "FoodServiceType" NOT NULL,
  "menuItemName" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FoodPayrollBatchItemService_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FoodPayrollAssignment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "batchItemId" TEXT NOT NULL,
  "status" "FoodPayrollAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "releasedById" TEXT,
  "releaseReason" VARCHAR(500),
  CONSTRAINT "FoodPayrollAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FoodPayrollReconciliation" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "status" "FoodPayrollReconciliationStatus" NOT NULL DEFAULT 'RECEIVED',
  "externalReference" VARCHAR(160),
  "receivedAmount" DECIMAL(12,2) NOT NULL,
  "reconciledAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "unreconciledAmount" DECIMAL(12,2) NOT NULL,
  "differenceReason" VARCHAR(1000),
  "evidenceReference" VARCHAR(500),
  "evidenceSha256" VARCHAR(64),
  "evidenceContent" BYTEA,
  "actorId" TEXT NOT NULL,
  "reconciledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FoodPayrollReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FoodPayrollReconciliationItem" (
  "id" TEXT NOT NULL,
  "reconciliationId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "batchItemId" TEXT NOT NULL,
  "sentAmount" DECIMAL(12,2) NOT NULL,
  "deductedAmount" DECIMAL(12,2) NOT NULL,
  "undeductedAmount" DECIMAL(12,2) NOT NULL,
  "differenceReason" VARCHAR(1000),
  "employeeReference" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FoodPayrollReconciliationItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FoodPayrollAdjustment" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "batchItemId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "status" "FoodPayrollAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
  "originalAmount" DECIMAL(12,2) NOT NULL,
  "adjustedAmount" DECIMAL(12,2) NOT NULL,
  "differenceAmount" DECIMAL(12,2) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "externalReference" VARCHAR(160),
  "evidenceReference" VARCHAR(500),
  "evidenceSha256" VARCHAR(64),
  "evidenceContent" BYTEA,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMP(3),
  CONSTRAINT "FoodPayrollAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FoodPayrollAuditEvent" (
  "id" TEXT NOT NULL,
  "eventType" "FoodPayrollAuditEventType" NOT NULL,
  "batchId" TEXT,
  "actorId" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(120),
  "requestHash" CHAR(64),
  "orderCount" INTEGER NOT NULL DEFAULT 0,
  "reasonCode" VARCHAR(80),
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FoodPayrollAuditEvent_pkey" PRIMARY KEY ("id")
);

-- ------------------------------------------------------------------ índices (nomenclatura Prisma)
CREATE UNIQUE INDEX "FoodPayrollBatch_idempotencyKey_key" ON "FoodPayrollBatch"("idempotencyKey");
CREATE INDEX "FoodPayrollBatch_status_createdAt_idx" ON "FoodPayrollBatch"("status", "createdAt");
CREATE INDEX "FoodPayrollBatch_payrollReference_idx" ON "FoodPayrollBatch"("payrollReference");
CREATE INDEX "FoodPayrollBatch_createdById_createdAt_idx" ON "FoodPayrollBatch"("createdById", "createdAt");

CREATE UNIQUE INDEX "FoodPayrollBatchItem_batchId_orderId_key" ON "FoodPayrollBatchItem"("batchId", "orderId");
CREATE UNIQUE INDEX "FoodPayrollBatchItem_id_batchId_key" ON "FoodPayrollBatchItem"("id", "batchId");
CREATE UNIQUE INDEX "FoodPayrollBatchItem_id_orderId_batchId_key" ON "FoodPayrollBatchItem"("id", "orderId", "batchId");
CREATE INDEX "FoodPayrollBatchItem_batchId_employeeNumber_idx" ON "FoodPayrollBatchItem"("batchId", "employeeNumber");
CREATE INDEX "FoodPayrollBatchItem_batchId_serviceWeekStart_idx" ON "FoodPayrollBatchItem"("batchId", "serviceWeekStart");
CREATE INDEX "FoodPayrollBatchItem_employeeId_serviceWeekStart_idx" ON "FoodPayrollBatchItem"("employeeId", "serviceWeekStart");
CREATE INDEX "FoodPayrollBatchItem_orderId_idx" ON "FoodPayrollBatchItem"("orderId");

CREATE UNIQUE INDEX "FoodPayrollBatchItemService_batchItemId_reservationId_key" ON "FoodPayrollBatchItemService"("batchItemId", "reservationId");
CREATE INDEX "FoodPayrollBatchItemService_batchId_idx" ON "FoodPayrollBatchItemService"("batchId");
CREATE INDEX "FoodPayrollBatchItemService_reservationId_idx" ON "FoodPayrollBatchItemService"("reservationId");

CREATE INDEX "FoodPayrollAssignment_orderId_status_idx" ON "FoodPayrollAssignment"("orderId", "status");
CREATE INDEX "FoodPayrollAssignment_batchId_status_idx" ON "FoodPayrollAssignment"("batchId", "status");
CREATE INDEX "FoodPayrollAssignment_batchItemId_idx" ON "FoodPayrollAssignment"("batchItemId");

CREATE UNIQUE INDEX "FoodPayrollReconciliation_id_batchId_key" ON "FoodPayrollReconciliation"("id", "batchId");
CREATE INDEX "FoodPayrollReconciliation_batchId_reconciledAt_idx" ON "FoodPayrollReconciliation"("batchId", "reconciledAt");
CREATE INDEX "FoodPayrollReconciliation_externalReference_idx" ON "FoodPayrollReconciliation"("externalReference");
CREATE INDEX "FoodPayrollReconciliation_actorId_reconciledAt_idx" ON "FoodPayrollReconciliation"("actorId", "reconciledAt");

CREATE UNIQUE INDEX "FoodPayrollReconciliationItem_reconciliationId_batchItemId_key" ON "FoodPayrollReconciliationItem"("reconciliationId", "batchItemId");
CREATE INDEX "FoodPayrollReconciliationItem_batchItemId_idx" ON "FoodPayrollReconciliationItem"("batchItemId");

CREATE INDEX "FoodPayrollAdjustment_batchId_createdAt_idx" ON "FoodPayrollAdjustment"("batchId", "createdAt");
CREATE INDEX "FoodPayrollAdjustment_orderId_createdAt_idx" ON "FoodPayrollAdjustment"("orderId", "createdAt");
CREATE INDEX "FoodPayrollAdjustment_actorId_createdAt_idx" ON "FoodPayrollAdjustment"("actorId", "createdAt");
CREATE INDEX "FoodPayrollAdjustment_status_createdAt_idx" ON "FoodPayrollAdjustment"("status", "createdAt");

CREATE INDEX "FoodPayrollAuditEvent_batchId_createdAt_idx" ON "FoodPayrollAuditEvent"("batchId", "createdAt");
CREATE INDEX "FoodPayrollAuditEvent_actorId_createdAt_idx" ON "FoodPayrollAuditEvent"("actorId", "createdAt");
CREATE INDEX "FoodPayrollAuditEvent_eventType_createdAt_idx" ON "FoodPayrollAuditEvent"("eventType", "createdAt");

-- Barrera final contra cargos duplicados: un pedido solo puede tener una asignación ACTIVE.
CREATE UNIQUE INDEX "FoodPayrollAssignment_one_active_per_order"
  ON "FoodPayrollAssignment"("orderId")
  WHERE "status" = 'ACTIVE'::"FoodPayrollAssignmentStatus";

-- ------------------------------------------------------------------ integridad referencial
ALTER TABLE "FoodPayrollBatch" ADD CONSTRAINT "FoodPayrollBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollBatch" ADD CONSTRAINT "FoodPayrollBatch_exportedById_fkey" FOREIGN KEY ("exportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollBatch" ADD CONSTRAINT "FoodPayrollBatch_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FoodPayrollBatchItem" ADD CONSTRAINT "FoodPayrollBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FoodPayrollBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollBatchItem" ADD CONSTRAINT "FoodPayrollBatchItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "FoodOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollBatchItem" ADD CONSTRAINT "FoodPayrollBatchItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FoodPayrollBatchItemService" ADD CONSTRAINT "FoodPayrollBatchItemService_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FoodPayrollBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollBatchItemService" ADD CONSTRAINT "FoodPayrollBatchItemService_batchItemId_batchId_fkey" FOREIGN KEY ("batchItemId", "batchId") REFERENCES "FoodPayrollBatchItem"("id", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollBatchItemService" ADD CONSTRAINT "FoodPayrollBatchItemService_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FoodPayrollAssignment" ADD CONSTRAINT "FoodPayrollAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "FoodOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollAssignment" ADD CONSTRAINT "FoodPayrollAssignment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FoodPayrollBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollAssignment" ADD CONSTRAINT "FoodPayrollAssignment_batchItemId_orderId_batchId_fkey" FOREIGN KEY ("batchItemId", "orderId", "batchId") REFERENCES "FoodPayrollBatchItem"("id", "orderId", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollAssignment" ADD CONSTRAINT "FoodPayrollAssignment_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FoodPayrollReconciliation" ADD CONSTRAINT "FoodPayrollReconciliation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FoodPayrollBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollReconciliation" ADD CONSTRAINT "FoodPayrollReconciliation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollReconciliationItem" ADD CONSTRAINT "FoodPayrollReconciliationItem_reconciliationId_batchId_fkey" FOREIGN KEY ("reconciliationId", "batchId") REFERENCES "FoodPayrollReconciliation"("id", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollReconciliationItem" ADD CONSTRAINT "FoodPayrollReconciliationItem_batchItemId_batchId_fkey" FOREIGN KEY ("batchItemId", "batchId") REFERENCES "FoodPayrollBatchItem"("id", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollAdjustment" ADD CONSTRAINT "FoodPayrollAdjustment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FoodPayrollBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollAdjustment" ADD CONSTRAINT "FoodPayrollAdjustment_batchItemId_orderId_batchId_fkey" FOREIGN KEY ("batchItemId", "orderId", "batchId") REFERENCES "FoodPayrollBatchItem"("id", "orderId", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollAdjustment" ADD CONSTRAINT "FoodPayrollAdjustment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FoodPayrollAuditEvent" ADD CONSTRAINT "FoodPayrollAuditEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FoodPayrollBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodPayrollAuditEvent" ADD CONSTRAINT "FoodPayrollAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------ CHECK: importes exactos y coherencia
ALTER TABLE "FoodPayrollBatch"
  ADD CONSTRAINT "FoodPayrollBatch_reference_chk" CHECK ("payrollReference" = btrim("payrollReference") AND char_length("payrollReference") BETWEEN 1 AND 40),
  ADD CONSTRAINT "FoodPayrollBatch_idempotency_chk" CHECK (char_length("idempotencyKey") BETWEEN 8 AND 120 AND "idempotencyRequestHash" ~ '^[0-9a-f]{64}$' AND "previewDigest" ~ '^[0-9a-f]{64}$' AND "contractVersion" > 0),
  ADD CONSTRAINT "FoodPayrollBatch_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "FoodPayrollBatch_totals_chk" CHECK ("orderCount" >= 0 AND "employeeCount" >= 0 AND "employeeCount" <= "orderCount" AND "serviceCount" >= "orderCount" AND "committedAmount" >= 0),
  ADD CONSTRAINT "FoodPayrollBatch_generated_chk" CHECK ("status" = 'DRAFT' OR ("generatedAt" IS NOT NULL AND "orderCount" > 0 AND "committedAmount" > 0 AND "idempotencyResponse" IS NOT NULL)),
  ADD CONSTRAINT "FoodPayrollBatch_export_chk" CHECK (
    ("status" IN ('EXPORTED', 'PARTIALLY_RECONCILED', 'RECONCILED') AND "exportedAt" IS NOT NULL AND "exportedById" IS NOT NULL AND "fileSha256" ~ '^[0-9a-f]{64}$')
    OR ("status" IN ('DRAFT', 'GENERATED', 'VOIDED') AND "exportedAt" IS NULL AND "exportedById" IS NULL)),
  ADD CONSTRAINT "FoodPayrollBatch_void_chk" CHECK (
    ("status" = 'VOIDED' AND "voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND char_length(btrim(coalesce("voidReason", ''))) >= 5)
    OR ("status" <> 'VOIDED' AND "voidedAt" IS NULL AND "voidedById" IS NULL AND "voidReason" IS NULL));

ALTER TABLE "FoodPayrollBatchItem"
  ADD CONSTRAINT "FoodPayrollBatchItem_amount_chk" CHECK ("itemCount" > 0 AND "historicalUnitPrice" > 0 AND "committedAmount" > 0 AND "committedAmount" = "itemCount" * "historicalUnitPrice"),
  ADD CONSTRAINT "FoodPayrollBatchItem_source_chk" CHECK ("orderStatusSnapshot" = 'CONFIRMED' AND "payrollStatusSnapshot" = 'PENDING'),
  ADD CONSTRAINT "FoodPayrollBatchItem_employee_chk" CHECK (btrim("employeeNumber") <> '' AND btrim("employeeName") <> '' AND ("employeeStatusSnapshot" = 'ACTIVE' OR "inactiveEmployeeReviewed")),
  ADD CONSTRAINT "FoodPayrollBatchItem_fingerprint_chk" CHECK ("orderFingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "FoodPayrollBatchItemService"
  ADD CONSTRAINT "FoodPayrollBatchItemService_name_chk" CHECK (btrim("menuItemName") <> '');

ALTER TABLE "FoodPayrollAssignment"
  ADD CONSTRAINT "FoodPayrollAssignment_release_chk" CHECK (
    ("status" = 'ACTIVE' AND "releasedAt" IS NULL AND "releasedById" IS NULL AND "releaseReason" IS NULL)
    OR ("status" = 'RELEASED' AND "releasedAt" IS NOT NULL AND "releasedById" IS NOT NULL AND char_length(btrim(coalesce("releaseReason", ''))) >= 5));

ALTER TABLE "FoodPayrollAuditEvent"
  ADD CONSTRAINT "FoodPayrollAuditEvent_values_chk" CHECK ("orderCount" >= 0 AND ("requestHash" IS NULL OR "requestHash" ~ '^[0-9a-f]{64}$'));

-- ------------------------------------------------------------------ limpieza de fixtures QA
-- Única excepción a la inmutabilidad: borrar fixtures de prueba. Exige las tres condiciones a la vez:
-- (1) la transacción activa yellowflex.qa_fixture_cleanup = 'on' (SET LOCAL), (2) la base es
-- yellowflex_restore_test y (3) el lote tiene referencia 'QA-FIXTURE-%' (o la clave 'qa-fixture-%' en
-- eventos sin lote). En cualquier otra base de datos la función devuelve false.
CREATE FUNCTION "food_payroll_qa_fixture_cleanup"(p_batch text, p_key text DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('yellowflex.qa_fixture_cleanup', true), '') = 'on'
     AND current_database() = 'yellowflex_restore_test'
     AND (EXISTS (SELECT 1 FROM "FoodPayrollBatch" WHERE "id" = p_batch AND "payrollReference" LIKE 'QA-FIXTURE-%')
          OR (p_batch IS NULL AND p_key LIKE 'qa-fixture-%'))
$$;

-- ------------------------------------------------------------------ triggers: estados e inmutabilidad
-- Lote: sin DELETE. DRAFT -> GENERATED solo con totales que cuadran con detalles, servicios y asignaciones.
-- Después de DRAFT, los datos generados quedan congelados; solo transiciones de ciclo de vida permitidas.
CREATE FUNCTION "food_payroll_batch_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o "FoodPayrollBatch"; n "FoodPayrollBatch";
  c_items integer; c_emp integer; c_srv integer; c_amt numeric; c_svc_rows integer; c_assign integer;
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
    OR (o."status" = 'EXPORTED' AND n."status" IN ('PARTIALLY_RECONCILED', 'RECONCILED'))
    OR (o."status" = 'PARTIALLY_RECONCILED' AND n."status" = 'RECONCILED')) THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: transicion no permitida % -> %.', o."status", n."status";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FoodPayrollBatch_guard" BEFORE UPDATE OR DELETE ON "FoodPayrollBatch"
  FOR EACH ROW EXECUTE FUNCTION "food_payroll_batch_guard"();

-- Snapshots: solo se insertan mientras el lote está en DRAFT, deben coincidir con la fuente y nunca cambian.
CREATE FUNCTION "food_payroll_item_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b_status "FoodPayrollBatchStatus"; ord "FoodOrder";
BEGIN
  IF TG_OP = 'DELETE' AND "food_payroll_qa_fixture_cleanup"(OLD."batchId") THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: los snapshots de prenomina son inmutables.';
  END IF;
  SELECT "status" INTO b_status FROM "FoodPayrollBatch" WHERE "id" = NEW."batchId";
  IF b_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: solo se agregan detalles a un lote en DRAFT.';
  END IF;
  SELECT * INTO ord FROM "FoodOrder" WHERE "id" = NEW."orderId";
  IF ord."status" <> 'CONFIRMED' OR ord."payrollStatus" <> 'PENDING' OR ord."employeeId" <> NEW."employeeId"
     OR ord."menuWeekId" <> NEW."menuWeekId" OR ord."itemCount" <> NEW."itemCount"
     OR ord."unitPrice" <> NEW."historicalUnitPrice" OR ord."totalAmount" <> NEW."committedAmount"
     OR ord."confirmedAt" <> NEW."confirmedAtSnapshot" OR ord."createdAt" <> NEW."orderCreatedAtSnapshot" THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: el snapshot no coincide con el pedido fuente (%).', NEW."orderId";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FoodPayrollBatchItem_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FoodPayrollBatchItem"
  FOR EACH ROW EXECUTE FUNCTION "food_payroll_item_guard"();

CREATE FUNCTION "food_payroll_service_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b_status "FoodPayrollBatchStatus"; r "Reservation"; item_order text;
BEGIN
  IF TG_OP = 'DELETE' AND "food_payroll_qa_fixture_cleanup"(OLD."batchId") THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: los snapshots por servicio son inmutables.';
  END IF;
  SELECT "status" INTO b_status FROM "FoodPayrollBatch" WHERE "id" = NEW."batchId";
  IF b_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: solo se agregan servicios a un lote en DRAFT.';
  END IF;
  SELECT "orderId" INTO item_order FROM "FoodPayrollBatchItem" WHERE "id" = NEW."batchItemId";
  SELECT * INTO r FROM "Reservation" WHERE "id" = NEW."reservationId";
  IF r."foodOrderId" IS DISTINCT FROM item_order OR r."status" <> 'ACTIVE' OR r."menuItemId" <> NEW."menuItemId" THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: el servicio no corresponde a una reserva activa del pedido.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FoodPayrollBatchItemService_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FoodPayrollBatchItemService"
  FOR EACH ROW EXECUTE FUNCTION "food_payroll_service_guard"();

-- Asignaciones: alta solo en DRAFT sobre pedidos CONFIRMED/PENDING; única transición ACTIVE -> RELEASED
-- y únicamente cuando el lote ya está VOIDED (anulación controlada, Bloque B). Sin DELETE.
CREATE FUNCTION "food_payroll_assignment_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b_status "FoodPayrollBatchStatus"; o_status "FoodOrderStatus"; o_payroll "FoodOrderPayrollStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "food_payroll_qa_fixture_cleanup"(OLD."batchId") THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: las asignaciones no se eliminan.';
  END IF;
  SELECT "status" INTO b_status FROM "FoodPayrollBatch" WHERE "id" = NEW."batchId";
  IF TG_OP = 'INSERT' THEN
    SELECT "status", "payrollStatus" INTO o_status, o_payroll FROM "FoodOrder" WHERE "id" = NEW."orderId";
    IF b_status IS DISTINCT FROM 'DRAFT' OR NEW."status" <> 'ACTIVE' OR o_status <> 'CONFIRMED' OR o_payroll <> 'PENDING' THEN
      RAISE EXCEPTION 'YF_PAYROLL_GUARD: asignacion invalida para el pedido %.', NEW."orderId";
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."orderId" <> OLD."orderId" OR NEW."batchId" <> OLD."batchId"
     OR NEW."batchItemId" <> OLD."batchItemId" OR NEW."assignedAt" <> OLD."assignedAt" THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: la identidad de la asignacion es inmutable.';
  END IF;
  IF NOT (OLD."status" = 'ACTIVE' AND NEW."status" = 'RELEASED' AND b_status = 'VOIDED') THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: solo se liberan asignaciones ACTIVE de un lote anulado.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FoodPayrollAssignment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FoodPayrollAssignment"
  FOR EACH ROW EXECUTE FUNCTION "food_payroll_assignment_guard"();

-- Protección en base de datos: un pedido asignado a un lote activo no se cancela ni cambia su obligación.
CREATE FUNCTION "food_order_payroll_assignment_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "FoodPayrollAssignment" WHERE "orderId" = OLD."id" AND "status" = 'ACTIVE') AND (
       NEW."status" <> OLD."status" OR NEW."payrollStatus" <> OLD."payrollStatus" OR NEW."employeeId" <> OLD."employeeId"
    OR NEW."menuWeekId" <> OLD."menuWeekId" OR NEW."itemCount" <> OLD."itemCount"
    OR NEW."unitPrice" <> OLD."unitPrice" OR NEW."totalAmount" <> OLD."totalAmount") THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: el pedido % esta asignado a un lote de prenomina activo.', OLD."id";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FoodOrder_payroll_assignment_guard" BEFORE UPDATE ON "FoodOrder"
  FOR EACH ROW EXECUTE FUNCTION "food_order_payroll_assignment_guard"();

CREATE FUNCTION "reservation_payroll_assignment_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."foodOrderId" IS NOT NULL
     AND EXISTS (SELECT 1 FROM "FoodPayrollAssignment" WHERE "orderId" = OLD."foodOrderId" AND "status" = 'ACTIVE')
     AND (TG_OP = 'DELETE' OR NEW."status" <> OLD."status" OR NEW."menuItemId" <> OLD."menuItemId"
          OR NEW."employeeId" <> OLD."employeeId" OR NEW."foodOrderId" IS DISTINCT FROM OLD."foodOrderId") THEN
    RAISE EXCEPTION 'YF_PAYROLL_GUARD: la reserva pertenece a un pedido asignado a un lote activo.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Reservation_payroll_assignment_guard" BEFORE UPDATE OR DELETE ON "Reservation"
  FOR EACH ROW EXECUTE FUNCTION "reservation_payroll_assignment_guard"();

-- Historial auditable append-only.
CREATE FUNCTION "food_payroll_audit_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND "food_payroll_qa_fixture_cleanup"(OLD."batchId", OLD."idempotencyKey") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'YF_PAYROLL_GUARD: el historial de prenomina es de solo agregado.';
END $$;
CREATE TRIGGER "FoodPayrollAuditEvent_append_only" BEFORE UPDATE OR DELETE ON "FoodPayrollAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "food_payroll_audit_append_only"();

COMMIT;
