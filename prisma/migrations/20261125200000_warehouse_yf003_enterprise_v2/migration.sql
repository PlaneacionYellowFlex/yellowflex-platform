BEGIN;
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- YF-003 ENTERPRISE V2 · Almacén: integridad del libro mayor, historiales append-only, saldos materializados transaccionales,
-- vínculo explícito custodia–movimiento, auditoría de catálogo y excepciones de reconciliación documentadas.
-- Migración ADITIVA: no modifica ni elimina datos existentes (solo inicializa la tabla nueva de saldos desde el libro mayor).
-- Reemplaza a 20261125120000_warehouse_yf003_integrity (V1), que nunca se aplicó en ltflexi040.

-- 1) Tipos de operación idempotente.
ALTER TYPE "WarehouseStockOperationKind" ADD VALUE IF NOT EXISTS 'EXTERNAL_RECEIPT';
ALTER TYPE "WarehouseStockOperationKind" ADD VALUE IF NOT EXISTS 'OPERATIONAL_HANDOFF';
ALTER TYPE "WarehouseStockOperationKind" ADD VALUE IF NOT EXISTS 'EXTERNAL_ISSUE';
ALTER TYPE "WarehouseStockOperationKind" ADD VALUE IF NOT EXISTS 'MOVEMENT_REVERSAL';
ALTER TYPE "WarehouseStockOperationKind" ADD VALUE IF NOT EXISTS 'PRODUCTION_RECEIPT';
ALTER TYPE "WarehouseStockOperationKind" ADD VALUE IF NOT EXISTS 'RETURN_REQUEST';
ALTER TYPE "WarehouseStockOperationKind" ADD VALUE IF NOT EXISTS 'RETURN_RECEIPT';
ALTER TYPE "WarehouseStockOperationKind" ADD VALUE IF NOT EXISTS 'COUNT_LAUNCH';
ALTER TYPE "WarehouseStockOperationKind" ADD VALUE IF NOT EXISTS 'COUNT_COMPLETE';
ALTER TYPE "WarehouseStockOperationKind" ADD VALUE IF NOT EXISTS 'RECOUNT_REQUEST';
ALTER TYPE "WarehouseStockOperationKind" ADD VALUE IF NOT EXISTS 'RECOUNT_COMPLETE';
ALTER TYPE "WarehouseStockOperationKind" ADD VALUE IF NOT EXISTS 'DISCREPANCY_UPDATE';
ALTER TYPE "WarehouseStockOperationKind" ADD VALUE IF NOT EXISTS 'DISCREPANCY_APPROVAL';
ALTER TYPE "WarehouseStockOperationKind" ADD VALUE IF NOT EXISTS 'DISCREPANCY_REJECTION';

-- 2) Historial inmutable de expedientes de diferencia.
CREATE TABLE IF NOT EXISTS "WarehouseDiscrepancyEvent" (
    "id" TEXT NOT NULL,
    "discrepancyId" TEXT NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "fromStatus" VARCHAR(40),
    "toStatus" VARCHAR(40),
    "notes" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WarehouseDiscrepancyEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WarehouseDiscrepancyEvent_discrepancyId_createdAt_idx" ON "WarehouseDiscrepancyEvent"("discrepancyId", "createdAt");
CREATE INDEX IF NOT EXISTS "WarehouseDiscrepancyEvent_actorId_createdAt_idx" ON "WarehouseDiscrepancyEvent"("actorId", "createdAt");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WarehouseDiscrepancyEvent_discrepancyId_fkey') THEN
    ALTER TABLE "WarehouseDiscrepancyEvent" ADD CONSTRAINT "WarehouseDiscrepancyEvent_discrepancyId_fkey"
      FOREIGN KEY ("discrepancyId") REFERENCES "WarehouseDiscrepancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WarehouseDiscrepancyEvent_actorId_fkey') THEN
    ALTER TABLE "WarehouseDiscrepancyEvent" ADD CONSTRAINT "WarehouseDiscrepancyEvent_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 2b) Índice para reportes y paginación estable del libro mayor (fecha, creación, id).
CREATE INDEX IF NOT EXISTS "InventoryMovement_occurredAt_createdAt_id_idx" ON "InventoryMovement"("occurredAt" DESC, "createdAt" DESC, "id" DESC);


-- 3) Reglas del libro mayor en la base de datos (NOT VALID: obligatorias para todo movimiento nuevo; los históricos se revisan
--    con la reconciliación de solo lectura antes de un VALIDATE CONSTRAINT posterior y autorizado).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryMovement_quantity_positive') THEN
    ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_quantity_positive" CHECK ("quantity" > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryMovement_shape_by_type') THEN
    ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_shape_by_type" CHECK (
      CASE "type"
        WHEN 'INITIAL_BALANCE'    THEN "originLocationId" IS NULL AND "destinationLocationId" IS NOT NULL
        WHEN 'EXTERNAL_RECEIPT'   THEN "originLocationId" IS NULL AND "destinationLocationId" IS NOT NULL
        WHEN 'ADJUSTMENT_IN'      THEN "originLocationId" IS NULL AND "destinationLocationId" IS NOT NULL
        WHEN 'OPERATIONAL_RETURN' THEN "originLocationId" IS NULL AND "destinationLocationId" IS NOT NULL
        WHEN 'EXTERNAL_ISSUE'     THEN "originLocationId" IS NOT NULL AND "destinationLocationId" IS NULL
        WHEN 'ADJUSTMENT_OUT'     THEN "originLocationId" IS NOT NULL AND "destinationLocationId" IS NULL
        WHEN 'OPERATIONAL_HANDOFF' THEN "originLocationId" IS NOT NULL AND "destinationLocationId" IS NULL
        WHEN 'INTERNAL_TRANSFER'  THEN "originLocationId" IS NOT NULL AND "destinationLocationId" IS NOT NULL
                                       AND "originLocationId" <> "destinationLocationId"
        ELSE FALSE
      END) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryCustody_quantity_non_negative') THEN
    ALTER TABLE "InventoryCustody" ADD CONSTRAINT "InventoryCustody_quantity_non_negative" CHECK ("quantity" >= 0) NOT VALID;
  END IF;
END $$;

-- 4) Tablas nuevas.
ALTER TABLE "InventoryCustody" ADD COLUMN IF NOT EXISTS "sourceMovementId" TEXT;
ALTER TABLE "InventoryCustody" ADD COLUMN IF NOT EXISTS "closingMovementId" TEXT;
ALTER TABLE "InventoryCustody" ADD COLUMN IF NOT EXISTS "parentCustodyId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryCustody_sourceMovementId_key" ON "InventoryCustody"("sourceMovementId");
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryCustody_closingMovementId_key" ON "InventoryCustody"("closingMovementId");
CREATE INDEX IF NOT EXISTS "InventoryCustody_parentCustodyId_idx" ON "InventoryCustody"("parentCustodyId");

CREATE TABLE IF NOT EXISTS "InventoryStockBalance" (
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryStockBalance_pkey" PRIMARY KEY ("itemId", "locationId")
);
CREATE INDEX IF NOT EXISTS "InventoryStockBalance_locationId_idx" ON "InventoryStockBalance"("locationId");

CREATE TABLE IF NOT EXISTS "WarehouseCatalogAudit" (
    "id" TEXT NOT NULL,
    "entityType" VARCHAR(20) NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WarehouseCatalogAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WarehouseCatalogAudit_entityType_entityId_createdAt_idx" ON "WarehouseCatalogAudit"("entityType", "entityId", "createdAt");
CREATE INDEX IF NOT EXISTS "WarehouseCatalogAudit_actorId_createdAt_idx" ON "WarehouseCatalogAudit"("actorId", "createdAt");

CREATE TABLE IF NOT EXISTS "WarehouseReconciliationException" (
    "id" TEXT NOT NULL,
    "checkCode" VARCHAR(10) NOT NULL,
    "subjectType" VARCHAR(20) NOT NULL,
    "subjectId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WarehouseReconciliationException_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WarehouseReconciliationException_checkCode_subjectType_subjectId_key"
  ON "WarehouseReconciliationException"("checkCode", "subjectType", "subjectId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryCustody_sourceMovementId_fkey') THEN
    ALTER TABLE "InventoryCustody" ADD CONSTRAINT "InventoryCustody_sourceMovementId_fkey" FOREIGN KEY ("sourceMovementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryCustody_closingMovementId_fkey') THEN
    ALTER TABLE "InventoryCustody" ADD CONSTRAINT "InventoryCustody_closingMovementId_fkey" FOREIGN KEY ("closingMovementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryCustody_parentCustodyId_fkey') THEN
    ALTER TABLE "InventoryCustody" ADD CONSTRAINT "InventoryCustody_parentCustodyId_fkey" FOREIGN KEY ("parentCustodyId") REFERENCES "InventoryCustody"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryStockBalance_itemId_fkey') THEN
    ALTER TABLE "InventoryStockBalance" ADD CONSTRAINT "InventoryStockBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryStockBalance_locationId_fkey') THEN
    ALTER TABLE "InventoryStockBalance" ADD CONSTRAINT "InventoryStockBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WarehouseCatalogAudit_actorId_fkey') THEN
    ALTER TABLE "WarehouseCatalogAudit" ADD CONSTRAINT "WarehouseCatalogAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WarehouseReconciliationException_actorId_fkey') THEN
    ALTER TABLE "WarehouseReconciliationException" ADD CONSTRAINT "WarehouseReconciliationException_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 5) Los marcadores solo filtran los fixtures que limpia el propietario en QA.
-- El nombre visible del actor no participa. Se reserva el dominio de correo
-- y el espacio de codigos QA a los preparadores de fixtures.
CREATE OR REPLACE FUNCTION "yf_fixture_markers"() RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  raw text := current_setting('yellowflex.fixture_cleanup', true);
  m text;
  result text[] := ARRAY[]::text[];
BEGIN
  IF current_database() <> 'yellowflex_restore_test' OR NOT (
    COALESCE(inet_server_port(), 0) = 55432 OR (
      inet_server_port() = 55433 AND current_setting('cluster_name') = 'yellowflex-yf003v21-disposable'
    )
  ) THEN RETURN result; END IF;
  IF raw IS NULL OR raw = '' THEN RETURN result; END IF;
  FOREACH m IN ARRAY string_to_array(raw, ',') LOOP
    m := btrim(m);
    IF m ~* '^QA-[A-Z0-9][A-Z0-9-]{5,}$' THEN result := result || m; END IF;
  END LOOP;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public."yf_is_fixture"(item_id text, actor_id text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE m text;
BEGIN
  IF current_user <> pg_get_userbyid(
    (SELECT relowner FROM pg_class WHERE oid = 'public."InventoryStockBalance"'::regclass)
  ) THEN RETURN false; END IF;
  FOREACH m IN ARRAY public."yf_fixture_markers"() LOOP
    IF EXISTS (
      SELECT 1 FROM public."InventoryItem" i
      WHERE i."id" = item_id AND (i."code" = m OR starts_with(i."code", m || '-'))
    ) OR EXISTS (
      SELECT 1 FROM public."User" u
      WHERE u."id" = actor_id AND right(lower(u."email"), 16) = '@example.invalid'
        AND lower(split_part(u."email", '@', 1)) IN (lower(m), regexp_replace(lower(m), '^qa-(idempotency|transfer)-', 'qa.\1.'))
    ) OR EXISTS (
      SELECT 1 FROM public."User" u
      WHERE u."id" = actor_id AND right(lower(u."email"), 16) = '@example.invalid'
        AND right(lower(split_part(u."email", '@', 1)), length(m) + 1) = '.' || lower(m)
    ) THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public."yf_reserve_fixture_namespace"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE proposed text; previous text; pattern text;
BEGIN
  IF current_database() <> 'yellowflex_restore_test' OR NOT (
    COALESCE(inet_server_port(), 0) = 55432 OR (
      inet_server_port() = 55433 AND current_setting('cluster_name') = 'yellowflex-yf003v21-disposable'
    )
  ) THEN RETURN NEW; END IF;
  IF current_user = pg_get_userbyid(
    (SELECT relowner FROM pg_class WHERE oid = 'public."InventoryStockBalance"'::regclass)
  ) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'User' THEN
    proposed := NEW."email"; pattern := '@example[.]invalid$';
    IF TG_OP = 'UPDATE' THEN previous := OLD."email"; END IF;
  ELSE
    proposed := NEW."code"; pattern := '^QA-';
    IF TG_OP = 'UPDATE' THEN previous := OLD."code"; END IF;
  END IF;
  IF proposed IS DISTINCT FROM previous AND (proposed ~* pattern OR previous ~* pattern) THEN
    RAISE EXCEPTION 'YF_FIXTURE_NAMESPACE: marcador reservado para preparadores QA.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "User_yf_fixture_namespace" BEFORE INSERT OR UPDATE OF "email" ON public."User"
  FOR EACH ROW EXECUTE FUNCTION public."yf_reserve_fixture_namespace"();
CREATE TRIGGER "InventoryItem_yf_fixture_namespace" BEFORE INSERT OR UPDATE OF "code" ON public."InventoryItem"
  FOR EACH ROW EXECUTE FUNCTION public."yf_reserve_fixture_namespace"();

-- 6) Historias append-only. Para limpieza de QA se exige la identidad
-- propietaria ademas del destino y el marcador correspondiente.
CREATE OR REPLACE FUNCTION public."yf_append_only"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE item_id text; actor_id text;
BEGIN
  IF TG_OP = 'DELETE' AND current_user = pg_get_userbyid(
    (SELECT relowner FROM pg_class WHERE oid = 'public."InventoryStockBalance"'::regclass)
  ) THEN
    CASE TG_TABLE_NAME
      WHEN 'InventoryMovement' THEN item_id := OLD."itemId"; actor_id := OLD."actorId";
      WHEN 'InventoryCustodyEvent' THEN SELECT c."itemId" INTO item_id FROM public."InventoryCustody" c WHERE c."id" = OLD."custodyId"; actor_id := OLD."actorId";
      WHEN 'InventoryCustodyOperation' THEN SELECT c."itemId" INTO item_id FROM public."InventoryCustody" c WHERE c."id" = OLD."custodyId"; actor_id := OLD."actorId";
      WHEN 'WarehouseDiscrepancyEvent' THEN
        SELECT wc."itemId" INTO item_id FROM public."WarehouseDiscrepancy" d JOIN public."WarehouseCount" wc ON wc."id" = d."countId" WHERE d."id" = OLD."discrepancyId";
        actor_id := OLD."actorId";
      ELSE actor_id := OLD."actorId";
    END CASE;
    IF public."yf_is_fixture"(item_id, actor_id) THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'YF_APPEND_ONLY: % es un historial inmutable (% rechazado).', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
END $$;

CREATE OR REPLACE FUNCTION "yf_no_truncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'YF_APPEND_ONLY: TRUNCATE de % no permitido.', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;

DROP FUNCTION IF EXISTS "yf_inventory_movement_immutable"() CASCADE;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['InventoryMovement','InventoryCustodyEvent','InventoryCustodyOperation','WarehouseStockOperation',
                           'WarehouseDiscrepancyEvent','WarehouseCatalogAudit','WarehouseReconciliationException'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION "yf_append_only"()', t || '_append_only', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_truncate', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION "yf_no_truncate"()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- 7) Existencia materializada. La mantiene solo este disparador, en la misma transacción del movimiento. En una transferencia
--    las dos filas se actualizan en orden determinista (por ubicación) para no interbloquear transferencias opuestas.
CREATE OR REPLACE FUNCTION public."yf_stock_balance_apply"(p_item text, p_location text, p_delta numeric) RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public."InventoryStockBalance" ("itemId", "locationId", "quantity", "updatedAt") VALUES (p_item, p_location, p_delta, now())
  ON CONFLICT ("itemId", "locationId") DO UPDATE SET "quantity" = "InventoryStockBalance"."quantity" + EXCLUDED."quantity", "updatedAt" = now();
END $$;

CREATE OR REPLACE FUNCTION public."yf_stock_balance_maintain"() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r record; sign numeric; a text; b text; qa numeric; qb numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN r := NEW; sign := 1; ELSE r := OLD; sign := -1; END IF;
  a := r."originLocationId"; b := r."destinationLocationId";
  qa := -r."quantity" * sign; qb := r."quantity" * sign;
  IF a IS NOT NULL AND b IS NOT NULL AND b < a THEN
    PERFORM public."yf_stock_balance_apply"(r."itemId", b, qb); PERFORM public."yf_stock_balance_apply"(r."itemId", a, qa);
  ELSE
    IF a IS NOT NULL THEN PERFORM public."yf_stock_balance_apply"(r."itemId", a, qa); END IF;
    IF b IS NOT NULL THEN PERFORM public."yf_stock_balance_apply"(r."itemId", b, qb); END IF;
  END IF;
  RETURN NULL;
END $$;

-- El guard valida la identidad efectiva del propietario. La aplicacion
-- opera con un rol separado y solo el trigger del libro mayor se eleva.
CREATE OR REPLACE FUNCTION public."yf_stock_balance_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID)) THEN
    RAISE EXCEPTION 'YF_STOCK_BALANCE_PROTECTED: escritura reservada.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public."yf_rebuild_inventory_stock_balance"() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE n bigint; diff bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'YF_STOCK_BALANCE_REBUILD requiere READ COMMITTED' USING ERRCODE = '25000';
  END IF;
  LOCK TABLE public."InventoryMovement" IN SHARE ROW EXCLUSIVE MODE;
  DELETE FROM public."InventoryStockBalance";
  INSERT INTO public."InventoryStockBalance" ("itemId", "locationId", "quantity", "updatedAt")
  SELECT "itemId", loc, SUM(q), now() FROM (
    SELECT "itemId", "destinationLocationId" AS loc, "quantity" AS q FROM public."InventoryMovement" WHERE "destinationLocationId" IS NOT NULL
    UNION ALL SELECT "itemId", "originLocationId", -"quantity" FROM public."InventoryMovement" WHERE "originLocationId" IS NOT NULL
  ) ledger GROUP BY "itemId", loc;
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT count(*) INTO diff FROM public."yf_stock_balance_differences"();
  IF diff <> 0 THEN
    RAISE EXCEPTION 'YF_STOCK_BALANCE_REBUILD: % diferencias después de reconstruir', diff;
  END IF;
  RETURN n;
END $$;

-- Diferencias exactas entre libro mayor y saldos materializados (reconciliación R8; solo lectura).
CREATE OR REPLACE FUNCTION public."yf_stock_balance_differences"() RETURNS TABLE("itemId" text, "locationId" text, ledger numeric, materialized numeric)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH l AS (
    SELECT f."itemId", f.loc, SUM(f.q) AS q FROM (
      SELECT "itemId", "destinationLocationId" AS loc, "quantity" AS q FROM public."InventoryMovement" WHERE "destinationLocationId" IS NOT NULL
      UNION ALL SELECT "itemId", "originLocationId", -"quantity" FROM public."InventoryMovement" WHERE "originLocationId" IS NOT NULL) f
    GROUP BY f."itemId", f.loc)
  SELECT COALESCE(l."itemId", b."itemId"), COALESCE(l.loc, b."locationId"), COALESCE(l.q, 0), COALESCE(b."quantity", 0)
    FROM l FULL OUTER JOIN public."InventoryStockBalance" b ON b."itemId" = l."itemId" AND b."locationId" = l.loc
   WHERE COALESCE(l.q, 0) <> COALESCE(b."quantity", 0);
$$;

DROP TRIGGER IF EXISTS "InventoryMovement_stock_balance" ON "InventoryMovement";
CREATE TRIGGER "InventoryMovement_stock_balance" AFTER INSERT OR DELETE ON "InventoryMovement"
  FOR EACH ROW EXECUTE FUNCTION "yf_stock_balance_maintain"();
DROP TRIGGER IF EXISTS "InventoryStockBalance_guard" ON "InventoryStockBalance";
CREATE TRIGGER "InventoryStockBalance_guard" BEFORE INSERT OR UPDATE OR DELETE ON "InventoryStockBalance"
  FOR EACH ROW EXECUTE FUNCTION "yf_stock_balance_guard"();
DROP TRIGGER IF EXISTS "InventoryStockBalance_no_truncate" ON "InventoryStockBalance";
CREATE TRIGGER "InventoryStockBalance_no_truncate" BEFORE TRUNCATE ON "InventoryStockBalance"
  FOR EACH STATEMENT EXECUTE FUNCTION "yf_no_truncate"();

-- 8) Inicialización de saldos desde el libro mayor existente (mismo cálculo que la reconciliación; verificada sin diferencias).
-- Los permisos de roles de uso se instalan por separado.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON public."InventoryStockBalance" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER ON public."InventoryMovement", public."InventoryCustodyEvent",
  public."InventoryCustodyOperation", public."WarehouseStockOperation", public."WarehouseDiscrepancyEvent",
  public."WarehouseCatalogAudit", public."WarehouseReconciliationException" FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public."yf_stock_balance_apply"(text, text, numeric),
  public."yf_stock_balance_maintain"(), public."yf_stock_balance_guard"(),
  public."yf_rebuild_inventory_stock_balance"(), public."yf_stock_balance_differences"(),
  public."yf_append_only"(), public."yf_no_truncate"(), public."yf_fixture_markers"(),
  public."yf_is_fixture"(text, text), public."yf_reserve_fixture_namespace"() FROM PUBLIC;

SELECT public."yf_rebuild_inventory_stock_balance"();
COMMIT;
