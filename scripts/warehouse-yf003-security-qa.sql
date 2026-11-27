\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'yellowflex_restore_test' OR current_user <> 'postgres' OR inet_server_port() <> 55432 OR current_setting('cluster_name') <> '' OR replace(current_setting('data_directory'),chr(92),'/') <> 'C:/Program Files/PostgreSQL/17/data' THEN RAISE EXCEPTION 'Entorno QA incorrecto'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname LIKE 'yf_%') THEN RAISE EXCEPTION 'Roles preexistentes'; END IF;
END $$;

-- F4-01-crear-roles.sql


CREATE ROLE yf_platform_owner
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOREPLICATION NOBYPASSRLS;

CREATE ROLE yf_platform_app
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOREPLICATION NOBYPASSRLS;

CREATE ROLE yf_platform_migration
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOREPLICATION NOBYPASSRLS;

CREATE ROLE yf_warehouse_app
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOREPLICATION NOBYPASSRLS;

CREATE ROLE yf_warehouse_maintenance
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOREPLICATION NOBYPASSRLS;

GRANT yf_warehouse_app TO yf_platform_app;
GRANT yf_platform_owner TO yf_platform_migration;


RESET ROLE;
RESET search_path;

SELECT rolname, rolcanlogin, rolsuper,
       rolcreaterole, rolcreatedb, rolbypassrls
FROM pg_roles
WHERE rolname LIKE 'yf_%'
ORDER BY rolname;

CREATE ROLE yf_platform_qa_login LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT yf_platform_app TO yf_platform_qa_login;
ALTER ROLE yf_platform_qa_login SET search_path TO pg_catalog, public, pg_temp;

RESET ROLE;
RESET search_path;

-- F4-02-transferir-propietarios.sql
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN


    IF (SELECT count(*) FROM pg_tables
        WHERE schemaname = 'public') <> 58
    THEN
        RAISE EXCEPTION 'Cantidad de tablas inesperada';
    END IF;
END $$;

ALTER SCHEMA public OWNER TO yf_platform_owner;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE, TEMPORARY
ON DATABASE yellowflex_restore_test FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO
    yf_platform_app,
    yf_warehouse_app,
    yf_warehouse_maintenance;

DO $$
DECLARE
    obj record;
BEGIN
    FOR obj IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
        AND c.relkind IN ('r','p')
    LOOP
        EXECUTE format(
            'ALTER TABLE public.%I OWNER TO yf_platform_owner',
            obj.relname
        );
    END LOOP;

    FOR obj IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
        AND c.relkind = 'S'
    LOOP
        EXECUTE format(
            'ALTER SEQUENCE public.%I OWNER TO yf_platform_owner',
            obj.relname
        );
    END LOOP;

    FOR obj IN
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
        AND t.typtype = 'e'
    LOOP
        EXECUTE format(
            'ALTER TYPE public.%I OWNER TO yf_platform_owner',
            obj.typname
        );
    END LOOP;

    FOR obj IN
        SELECT p.proname,
               pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
        AND p.prokind = 'f'
    LOOP
        EXECUTE format(
            'ALTER FUNCTION public.%I(%s) OWNER TO yf_platform_owner',
            obj.proname, obj.args
        );
    END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE yf_platform_owner
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tableowner <> 'yf_platform_owner'
    ) THEN
        RAISE EXCEPTION 'Transferencia incompleta';
    END IF;

    IF pg_has_role(
        'yf_platform_app',
        'yf_platform_owner',
        'MEMBER'
    ) THEN
        RAISE EXCEPTION 'Aplicacion vinculada al propietario';
    END IF;

    IF has_schema_privilege(
        'yf_platform_app', 'public', 'CREATE'
    ) THEN
        RAISE EXCEPTION 'Aplicacion puede crear objetos';
    END IF;

    IF has_database_privilege(
        'yf_platform_app',
        current_database(),
        'CREATE'
    ) THEN
        RAISE EXCEPTION 'Aplicacion puede crear esquemas';
    END IF;
END $$;


RESET ROLE;
RESET search_path;

SELECT tableowner AS propietario,
       count(*) AS tablas
FROM pg_tables
WHERE schemaname = 'public'
GROUP BY tableowner;

SELECT pg_get_userbyid(p.proowner) AS propietario,
       count(*) AS funciones
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
GROUP BY p.proowner;

SELECT count(*) AS movimientos
FROM public."InventoryMovement";

SELECT count(*) AS saldos
FROM public."InventoryStockBalance";

SELECT count(*) AS migraciones
FROM public."_prisma_migrations"
WHERE finished_at IS NOT NULL
AND rolled_back_at IS NULL;

RESET ROLE;
RESET search_path;

-- F4-03-privilegios-warehouse.sql


SET ROLE yf_platform_owner;
-- Ejecutar una vez en cada base autorizada, despu????s de la migraci????n,
-- como propietario de los objetos, con los roles previamente provisionados.

SET LOCAL search_path = pg_catalog, pg_temp;
DO $$
DECLARE
  r record;
  balance_owner name;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO STRICT balance_owner
  FROM pg_class WHERE oid = 'public."InventoryStockBalance"'::regclass;
  IF current_user <> balance_owner THEN
    RAISE EXCEPTION 'Ejecute como propietario de InventoryStockBalance';
  END IF;
  FOR r IN SELECT * FROM pg_roles WHERE rolname IN ('yf_warehouse_app','yf_warehouse_maintenance') LOOP
    IF r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolcanlogin
       OR pg_has_role(r.rolname, balance_owner, 'MEMBER')
       OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid)
    THEN RAISE EXCEPTION 'Rol % con privilegios o membres????as incompatibles', r.rolname;
    END IF;
  END LOOP;
  IF has_schema_privilege('yf_warehouse_app', 'public', 'CREATE')
     OR has_parameter_privilege('yf_warehouse_app', 'session_replication_role', 'SET')
     OR has_database_privilege('yf_warehouse_app', current_database(), 'CREATE')
  THEN RAISE EXCEPTION 'Revoque CREATE y SET efectivos de la aplicaci????n antes de continuar'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('yf_stock_balance_maintain','yf_rebuild_inventory_stock_balance')
      AND (pg_get_userbyid(p.proowner) <> balance_owner OR NOT p.prosecdef)
  ) THEN RAISE EXCEPTION 'Propietario de funciones o SECURITY DEFINER divergente'; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO yf_warehouse_app, yf_warehouse_maintenance;
REVOKE ALL ON public."InventoryStockBalance", public."InventoryMovement", public."InventoryCustodyEvent",
  public."InventoryCustodyOperation", public."WarehouseStockOperation", public."WarehouseDiscrepancyEvent",
  public."WarehouseCatalogAudit", public."WarehouseReconciliationException" FROM yf_warehouse_app, yf_warehouse_maintenance;
GRANT SELECT ON public."InventoryStockBalance" TO yf_warehouse_app;
GRANT SELECT, INSERT ON public."InventoryMovement", public."InventoryCustodyEvent",
  public."InventoryCustodyOperation", public."WarehouseStockOperation", public."WarehouseDiscrepancyEvent",
  public."WarehouseCatalogAudit", public."WarehouseReconciliationException" TO yf_warehouse_app;
GRANT SELECT, INSERT, UPDATE ON public."InventoryItem", public."WarehouseLocation", public."InventoryCustody",
  public."WarehouseCount", public."WarehouseDiscrepancy", public."WarehouseDiscrepancyRecount" TO yf_warehouse_app;
GRANT SELECT ON public."Warehouse" TO yf_warehouse_app;

REVOKE EXECUTE ON FUNCTION public."yf_stock_balance_apply"(text, text, numeric),
  public."yf_stock_balance_maintain"(), public."yf_stock_balance_guard"(),
  public."yf_append_only"(), public."yf_no_truncate"(), public."yf_fixture_markers"(),
  public."yf_is_fixture"(text, text), public."yf_reserve_fixture_namespace"(),
  public."yf_stock_balance_differences"(), public."yf_rebuild_inventory_stock_balance"()
  FROM yf_warehouse_app, yf_warehouse_maintenance;
GRANT EXECUTE ON FUNCTION public."yf_stock_balance_differences"() TO yf_warehouse_app;
GRANT EXECUTE ON FUNCTION public."yf_rebuild_inventory_stock_balance"() TO yf_warehouse_maintenance;

DO $$
DECLARE t regclass;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'public."InventoryStockBalance"'::regclass, 'public."InventoryMovement"'::regclass,
    'public."InventoryCustodyEvent"'::regclass, 'public."InventoryCustodyOperation"'::regclass,
    'public."WarehouseStockOperation"'::regclass, 'public."WarehouseDiscrepancyEvent"'::regclass,
    'public."WarehouseCatalogAudit"'::regclass, 'public."WarehouseReconciliationException"'::regclass
  ] LOOP
    IF has_table_privilege('yf_warehouse_app', t, 'UPDATE, DELETE, TRUNCATE, TRIGGER')
       OR has_any_column_privilege('yf_warehouse_app', t, 'UPDATE')
       OR (t = 'public."InventoryStockBalance"'::regclass AND has_any_column_privilege('yf_warehouse_app', t, 'INSERT'))
       OR pg_has_role('yf_warehouse_app', (SELECT relowner FROM pg_class WHERE oid = t), 'MEMBER')
    THEN RAISE EXCEPTION 'Permisos efectivos incompatibles en %', t; END IF;
  END LOOP;
  IF has_function_privilege('yf_warehouse_app', 'public.yf_stock_balance_apply(text,text,numeric)', 'EXECUTE')
     OR has_function_privilege('yf_warehouse_app', 'public.yf_stock_balance_maintain()', 'EXECUTE')
     OR has_function_privilege('yf_warehouse_app', 'public.yf_rebuild_inventory_stock_balance()', 'EXECUTE')
  THEN RAISE EXCEPTION 'La aplicaci????n conserva EXECUTE sobre funciones internas'; END IF;
END $$;

RESET ROLE;
RESET search_path;

RESET ROLE;

SELECT c.relname AS tabla,
    has_table_privilege(
        'yf_platform_app', c.oid, 'SELECT'
    ) AS consultar,
    has_table_privilege(
        'yf_platform_app', c.oid, 'INSERT'
    ) AS insertar,
    has_table_privilege(
        'yf_platform_app', c.oid, 'UPDATE'
    ) AS actualizar,
    has_table_privilege(
        'yf_platform_app', c.oid, 'DELETE'
    ) AS eliminar,
    has_table_privilege(
        'yf_platform_app', c.oid, 'TRUNCATE'
    ) AS truncar
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
AND c.relkind = 'r'
AND (
    c.relname LIKE 'Inventory%'
    OR c.relname LIKE 'Warehouse%'
)
ORDER BY c.relname;

SELECT
    has_function_privilege(
        'yf_platform_app',
        'public.yf_rebuild_inventory_stock_balance()',
        'EXECUTE'
    ) AS app_puede_reconstruir,
    has_function_privilege(
        'yf_warehouse_maintenance',
        'public.yf_rebuild_inventory_stock_balance()',
        'EXECUTE'
    ) AS mantenimiento_puede_reconstruir;

SELECT count(*) AS movimientos
FROM public."InventoryMovement";

SELECT count(*) AS saldos
FROM public."InventoryStockBalance";
RESET ROLE;
RESET search_path;

-- F4-04-privilegios-platform.sql
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';



SET LOCAL ROLE yf_platform_owner;

-- Autenticacion y C-PANEL

GRANT SELECT, INSERT, UPDATE
ON public."User",
   public."CorporateModulePermission",
   public."PurchasePermission",
   public."WarehousePermission"
TO yf_platform_app;

GRANT SELECT, INSERT, DELETE
ON public."CorporateSession",
   public."UserRole",
   public."FoodAccessSession"
TO yf_platform_app;

GRANT SELECT, INSERT
ON public."CorporatePermissionAudit"
TO yf_platform_app;

-- Recursos Humanos

GRANT SELECT
ON public."Department",
   public."OperationalArea",
   public."WorkShift",
   public."VacationBalance",
   public."HrRequestAttachment"
TO yf_platform_app;

GRANT SELECT, UPDATE
ON public."Employee"
TO yf_platform_app;

GRANT SELECT, INSERT, UPDATE
ON public."EmployeeProfile",
   public."HrRequest"
TO yf_platform_app;

GRANT SELECT, INSERT
ON public."EmployeeMovement",
   public."EmployeeTimeMovement",
   public."HrRequestDecision",
   public."HrRequestEvent"
TO yf_platform_app;

-- Food Services

GRANT SELECT, INSERT, UPDATE
ON public."FoodOrder",
   public."FoodExtraordinaryService",
   public."MenuWeek",
   public."MenuItem"
TO yf_platform_app;

GRANT SELECT, INSERT
ON public."MenuDay",
   public."Consumption",
   public."FoodOrderCancellation"
TO yf_platform_app;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public."Reservation"
TO yf_platform_app;

-- Prenomina y conciliacion

GRANT SELECT, INSERT, UPDATE
ON public."FoodPayrollBatch",
   public."FoodPayrollAssignment",
   public."FoodPayrollAdjustment",
   public."FoodPayrollReconciliation"
TO yf_platform_app;

GRANT SELECT, INSERT
ON public."FoodPayrollBatchItem",
   public."FoodPayrollBatchItemService",
   public."FoodPayrollReconciliationEmployee",
   public."FoodPayrollAuditEvent"
TO yf_platform_app;

GRANT SELECT
ON public."FoodPayrollReconciliationItem"
TO yf_platform_app;

-- Compras

GRANT SELECT, INSERT, UPDATE
ON public."PurchaseRequest"
TO yf_platform_app;

GRANT SELECT, INSERT
ON public."PurchaseRequestItem",
   public."PurchaseDecision",
   public."PurchaseDocument",
   public."PurchaseEvent"
TO yf_platform_app;

-- Restringir funciones Food Services existentes

DO $$
DECLARE
    obj record;
BEGIN
    FOR obj IN
        SELECT p.proname,
               pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
        AND (
            p.proname LIKE 'food_%'
            OR p.proname = 'reservation_payroll_assignment_guard'
        )
    LOOP
        EXECUTE format(
            'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC',
            obj.proname, obj.args
        );
    END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION
    public.food_payroll_employee_covered(text, text)
TO yf_platform_app;

-- Verificacion de restricciones criticas

DO $$
DECLARE
    tabla text;
BEGIN
    FOREACH tabla IN ARRAY ARRAY[
        'InventoryMovement',
        'InventoryStockBalance',
        'InventoryCustodyEvent',
        'InventoryCustodyOperation',
        'WarehouseCatalogAudit',
        'WarehouseDiscrepancyEvent',
        'WarehouseStockOperation',
        'WarehouseReconciliationException',
        'CorporatePermissionAudit',
        'FoodPayrollAuditEvent',
        'FoodPayrollBatchItem',
        'FoodPayrollBatchItemService',
        'FoodPayrollReconciliationEmployee'
    ]
    LOOP
        IF has_table_privilege(
            'yf_platform_app',
            format('public.%I', tabla),
            'UPDATE'
        ) OR has_table_privilege(
            'yf_platform_app',
            format('public.%I', tabla),
            'DELETE'
        ) OR has_table_privilege(
            'yf_platform_app',
            format('public.%I', tabla),
            'TRUNCATE'
        ) THEN
            RAISE EXCEPTION 'Privilegios excesivos: %', tabla;
        END IF;
    END LOOP;

    IF has_table_privilege(
        'yf_platform_app',
        'public."InventoryStockBalance"',
        'INSERT'
    ) THEN
        RAISE EXCEPTION 'Insercion directa de saldos permitida';
    END IF;

    IF has_table_privilege(
        'yf_platform_app',
        'public."_prisma_migrations"',
        'SELECT,INSERT,UPDATE,DELETE'
    ) THEN
        RAISE EXCEPTION 'Aplicacion tiene acceso a migraciones';
    END IF;

    IF has_function_privilege(
        'yf_platform_app',
        'public.yf_rebuild_inventory_stock_balance()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'Reconstruccion no autorizada';
    END IF;
END $$;


RESET ROLE;
RESET search_path;

SELECT
    c.relname AS tabla,
    has_table_privilege(
        'yf_platform_app', c.oid, 'SELECT'
    ) AS s,
    has_table_privilege(
        'yf_platform_app', c.oid, 'INSERT'
    ) AS i,
    has_table_privilege(
        'yf_platform_app', c.oid, 'UPDATE'
    ) AS u,
    has_table_privilege(
        'yf_platform_app', c.oid, 'DELETE'
    ) AS d,
    has_table_privilege(
        'yf_platform_app', c.oid, 'TRUNCATE'
    ) AS t
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
AND c.relkind = 'r'
ORDER BY c.relname;

SELECT
    (SELECT count(*) FROM public."InventoryMovement")
        AS movimientos,
    (SELECT count(*) FROM public."InventoryStockBalance")
        AS saldos,
    (SELECT count(*) FROM public."FoodPayrollBatch")
        AS lotes,
    (SELECT count(*) FROM public."_prisma_migrations"
     WHERE finished_at IS NOT NULL
     AND rolled_back_at IS NULL)
        AS migraciones;

RESET ROLE;
RESET search_path;

-- F5-03-proteccion-warehouse.sql
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;



SET LOCAL ROLE yf_platform_owner;

CREATE FUNCTION public.yf_warehouse_catalog_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF current_user <> 'yf_platform_owner' THEN
        RAISE EXCEPTION 'Modificacion de Warehouse no autorizada'
            USING ERRCODE = '42501';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION
    public.yf_warehouse_catalog_update_guard()
FROM PUBLIC;

CREATE TRIGGER yf_warehouse_catalog_update_guard
BEFORE UPDATE ON public."Warehouse"
FOR EACH STATEMENT
EXECUTE FUNCTION public.yf_warehouse_catalog_update_guard();

GRANT UPDATE ("id")
ON public."Warehouse"
TO yf_warehouse_app;

RESET ROLE;

SET LOCAL ROLE yf_platform_qa_login;

SELECT 1 AS bloqueo_correcto
FROM public."Warehouse"
LIMIT 1
FOR SHARE;

DO $$
BEGIN
    BEGIN
        UPDATE public."Warehouse"
        SET "id" = "id"
        WHERE false;

        RAISE EXCEPTION 'FALLO: UPDATE Warehouse permitido';
    EXCEPTION
        WHEN insufficient_privilege THEN
            IF SQLERRM <>
                'Modificacion de Warehouse no autorizada'
            THEN
                RAISE;
            END IF;

            RAISE NOTICE 'PASS 01: UPDATE bloqueado por trigger';
    END;

    BEGIN
        DELETE FROM public."Warehouse"
        WHERE false;

        RAISE EXCEPTION 'FALLO: DELETE Warehouse permitido';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS 02: DELETE Warehouse denegado';
    END;

    BEGIN
        ALTER TABLE public."Warehouse"
        DISABLE TRIGGER yf_warehouse_catalog_update_guard;

        RAISE EXCEPTION 'FALLO: desactivar proteccion permitido';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS 03: proteccion no desactivable';
    END;

    IF has_table_privilege(
        current_user,
        'public."Warehouse"',
        'UPDATE'
    ) THEN
        RAISE EXCEPTION 'FALLO: UPDATE general concedido';
    END IF;

    RAISE NOTICE 'PASS 04: sin UPDATE general';

    IF NOT has_column_privilege(
        current_user,
        'public."Warehouse"',
        'id',
        'UPDATE'
    ) THEN
        RAISE EXCEPTION 'FALLO: permiso de bloqueo ausente';
    END IF;

    RAISE NOTICE 'PASS 05: permiso limitado a columna';
END $$;

RESET ROLE;


RESET ROLE;
RESET search_path;

SELECT count(*) AS almacenes
FROM public."Warehouse";

SELECT count(*) AS movimientos
FROM public."InventoryMovement";

SELECT count(*) AS saldos
FROM public."InventoryStockBalance";

RESET ROLE;
RESET search_path;

-- F5-14-R1-privilegios.sql
DO $guard$
BEGIN


    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid =
          'public.food_payroll_qa_fixture_cleanup(text,text)'::regprocedure
          AND NOT prosecdef
          AND provolatile = 's'
          AND prorettype = 'boolean'::regtype
          AND pg_get_userbyid(proowner) = 'yf_platform_owner'
    ) THEN
        RAISE EXCEPTION 'Funcion inesperada';
    END IF;
END;
$guard$;

SET LOCAL ROLE yf_platform_owner;

GRANT EXECUTE ON FUNCTION
    public.food_payroll_qa_fixture_cleanup(text,text)
TO yf_platform_app;

RESET ROLE;

DO $verify$
DECLARE
    tabla text;
BEGIN
    IF NOT has_function_privilege(
        'yf_platform_qa_login',
        'public.food_payroll_qa_fixture_cleanup(text,text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'Permiso de ejecucion faltante';
    END IF;

    FOREACH tabla IN ARRAY ARRAY[
        'FoodPayrollBatch',
        'FoodPayrollBatchItem',
        'FoodPayrollBatchItemService',
        'FoodPayrollAssignment',
        'FoodPayrollAuditEvent',
        'FoodPayrollAdjustment',
        'FoodPayrollReconciliation',
        'FoodPayrollReconciliationEmployee',
        'FoodPayrollReconciliationItem'
    ]
    LOOP
        IF has_table_privilege(
            'yf_platform_qa_login',
            format('public.%I', tabla),
            'DELETE'
        ) OR has_table_privilege(
            'yf_platform_qa_login',
            format('public.%I', tabla),
            'TRUNCATE'
        ) THEN
            RAISE EXCEPTION 'Permiso destructivo: %', tabla;
        END IF;

        RAISE NOTICE 'PROTEGIDA: %', tabla;
    END LOOP;
END;
$verify$;


RESET ROLE;
RESET search_path;

RESET ROLE;
RESET search_path;

-- F5-19-D.sql


SELECT 'ESTADO INICIAL' AS seccion;

SELECT count(*) AS diferencias
FROM public.yf_stock_balance_differences();

-- El rol de migracion debe asumir explicitamente
-- los privilegios del propietario.

ALTER ROLE yf_platform_migration NOINHERIT;

GRANT yf_platform_owner TO yf_platform_migration
WITH INHERIT FALSE;

GRANT yf_platform_owner TO yf_platform_migration
WITH SET TRUE;

-- Crear protecciones bajo el propietario controlado.

SET LOCAL ROLE yf_platform_owner;

CREATE FUNCTION public.yf_referenced_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    columna text;
BEGIN
    FOREACH columna IN ARRAY TG_ARGV
    LOOP
        IF (to_jsonb(OLD) -> columna)
           IS DISTINCT FROM
           (to_jsonb(NEW) -> columna)
        THEN
            RAISE EXCEPTION
                'YF_IMMUTABLE_IDENTITY: %.%',
                TG_TABLE_NAME, columna
                USING ERRCODE = '42501';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION
public.yf_referenced_identity_guard()
FROM PUBLIC;

-- Warehouse ya dispone de una proteccion mas estricta.
-- Se protegen las otras 16 tablas.

DO $$
DECLARE
    r record;
    columnas text;
    argumentos text;
BEGIN
    FOR r IN
        SELECT *
        FROM (
            VALUES
                ('Employee', ARRAY['id']),
                ('FoodOrder', ARRAY['id']),
                ('FoodPayrollAdjustment', ARRAY['id']),
                ('FoodPayrollBatch', ARRAY['id']),
                ('FoodPayrollReconciliation', ARRAY['id','batchId']),
                ('HrRequest', ARRAY['id']),
                ('InventoryCustody', ARRAY['id']),
                ('InventoryItem', ARRAY['id']),
                ('MenuItem', ARRAY['id']),
                ('MenuWeek', ARRAY['id']),
                ('PurchaseRequest', ARRAY['id']),
                ('Reservation', ARRAY['id']),
                ('User', ARRAY['id']),
                ('WarehouseCount', ARRAY['id']),
                ('WarehouseDiscrepancy', ARRAY['id']),
                ('WarehouseLocation', ARRAY['id'])
        ) AS v(tabla, campos)
    LOOP
        SELECT string_agg(format('%I', x), ', '),
               string_agg(format('%L', x), ', ')
        INTO columnas, argumentos
        FROM unnest(r.campos) AS x;

        EXECUTE format(
            'CREATE TRIGGER yf_referenced_identity_guard
             BEFORE UPDATE OF %s ON public.%I
             FOR EACH ROW
             EXECUTE FUNCTION
             public.yf_referenced_identity_guard(%s)',
            columnas,
            r.tabla,
            argumentos
        );

        RAISE NOTICE 'PROTECCION INSTALADA: %', r.tabla;
    END LOOP;
END $$;

-- Fijar el search_path de las funciones identificadas.

DO $$
DECLARE
    r record;
    total integer := 0;
BEGIN
    FOR r IN
        SELECT p.proname,
               pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prokind = 'f'
          AND NOT EXISTS (
              SELECT 1
              FROM unnest(p.proconfig) AS cfg
              WHERE cfg LIKE 'search_path=%'
          )
    LOOP
        IF r.proname NOT LIKE 'food_%'
           AND r.proname NOT IN (
               'reservation_payroll_assignment_guard',
               'yf_no_truncate'
           )
        THEN
            RAISE EXCEPTION
                'Funcion inesperada: %', r.proname;
        END IF;

        EXECUTE format(
            'ALTER FUNCTION public.%I(%s)
             SET search_path = pg_catalog, public, pg_temp',
            r.proname, r.args
        );

        total := total + 1;

        RAISE NOTICE 'SEARCH PATH FIJADO: %', r.proname;
    END LOOP;

    IF total <> 14 THEN
        RAISE EXCEPTION
            'Se esperaban 14 funciones, obtenidas %', total;
    END IF;
END $$;

RESET ROLE;

SELECT 'VALIDACION DE PROTECCIONES' AS seccion;

DO $$
DECLARE
    total integer;
BEGIN
    SELECT count(*) INTO total
    FROM pg_trigger
    WHERE tgname = 'yf_referenced_identity_guard'
      AND tgenabled = 'O'
      AND NOT tgisinternal;

    IF total <> 16 THEN
        RAISE EXCEPTION
            'Cantidad incorrecta de protecciones: %', total;
    END IF;

    IF pg_has_role(
        'yf_platform_migration',
        'yf_platform_owner',
        'USAGE'
    ) THEN
        RAISE EXCEPTION 'Herencia automatica no eliminada';
    END IF;

    IF NOT pg_has_role(
        'yf_platform_migration',
        'yf_platform_owner',
        'SET'
    ) THEN
        RAISE EXCEPTION 'Cambio explicito de rol bloqueado';
    END IF;

    RAISE NOTICE 'CONFIGURACION DE SEGURIDAD CORRECTA';
END $$;

-- Pruebas negativas bajo el rol restringido.
-- Los cambios inesperadamente permitidos abortan
-- la transaccion completa.

SET LOCAL ROLE yf_platform_qa_login;

DO $$
DECLARE
    tabla text;
    identificador text;
    mensaje text;
    aprobadas integer := 0;
BEGIN
    FOREACH tabla IN ARRAY ARRAY[
        'Employee',
        'User',
        'InventoryItem',
        'WarehouseLocation',
        'FoodOrder',
        'PurchaseRequest'
    ]
    LOOP
        EXECUTE format(
            'SELECT id::text FROM public.%I LIMIT 1',
            tabla
        ) INTO identificador;

        IF identificador IS NULL THEN
            RAISE EXCEPTION 'Tabla sin datos: %', tabla;
        END IF;

        BEGIN
            EXECUTE format(
                'UPDATE public.%I
                 SET id = id || %L
                 WHERE id = %L',
                tabla,
                '-F519D',
                identificador
            );

            RAISE EXCEPTION
                'Cambio de identidad permitido: %', tabla;

        EXCEPTION
            WHEN insufficient_privilege THEN
                GET STACKED DIAGNOSTICS
                    mensaje = MESSAGE_TEXT;

                IF mensaje NOT LIKE
                    'YF_IMMUTABLE_IDENTITY:%'
                THEN
                    RAISE;
                END IF;

                aprobadas := aprobadas + 1;

                RAISE NOTICE
                    'IDENTIDAD PROTEGIDA: %', tabla;
        END;
    END LOOP;

    IF aprobadas <> 6 THEN
        RAISE EXCEPTION 'Pruebas incompletas';
    END IF;

    RAISE NOTICE 'PRUEBAS NEGATIVAS: 6/6';
END $$;

-- Las actualizaciones sin cambio de identidad
-- y los bloqueos de Prisma deben seguir disponibles.

UPDATE public."User"
SET id = id
WHERE false;

UPDATE public."Employee"
SET id = id
WHERE false;

SELECT id FROM public."Warehouse"
LIMIT 1 FOR SHARE;

SELECT id FROM public."InventoryItem"
LIMIT 1 FOR UPDATE;

RESET ROLE;

SELECT 'INTEGRIDAD FINAL' AS seccion;

DO $$
BEGIN
    IF (SELECT count(*) FROM public."InventoryMovement") <> 478
       OR (SELECT count(*) FROM public."InventoryStockBalance") <> 475
       OR (SELECT count(*) FROM public."InventoryItem") <> 204
       OR (SELECT count(*) FROM public."Warehouse") <> 2
       OR (SELECT count(*) FROM public."User") <> 14
       OR (SELECT count(*) FROM public."Employee") <> 94
       OR (SELECT count(*) FROM public."FoodPayrollBatch") <> 0
       OR (SELECT count(*) FROM public."_prisma_migrations") <> 32
       OR EXISTS (
           SELECT 1
           FROM public.yf_stock_balance_differences()
       )
    THEN
        RAISE EXCEPTION 'Integridad final incorrecta';
    END IF;
END $$;

SELECT
    (SELECT count(*) FROM public."InventoryMovement") AS movimientos,
    (SELECT count(*) FROM public."InventoryStockBalance") AS saldos,
    (SELECT count(*) FROM public.yf_stock_balance_differences()) AS diferencias,
    (SELECT count(*) FROM pg_trigger
     WHERE tgname = 'yf_referenced_identity_guard') AS nuevas_protecciones;

SELECT
    pg_has_role(
        'yf_platform_migration',
        'yf_platform_owner',
        'USAGE'
    ) AS herencia_automatica,
    pg_has_role(
        'yf_platform_migration',
        'yf_platform_owner',
        'SET'
    ) AS cambio_explicito;


RESET ROLE;
RESET search_path;

SELECT 'F5-19-D VALIDADO' AS resultado;

RESET ROLE;
RESET search_path;

-- F5-20-C1.sql


SELECT 'DEFINICION ORIGINAL' AS seccion;

SELECT pg_get_functiondef(
    'public.food_payroll_qa_fixture_cleanup(text,text)'::regprocedure
);

SET LOCAL ROLE yf_platform_owner;

CREATE OR REPLACE FUNCTION public.food_payroll_qa_fixture_cleanup(
    p_batch text,
    p_key text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
    SELECT current_user = 'yf_platform_owner'
       AND coalesce(
           current_setting('yellowflex.qa_fixture_cleanup', true),
           ''
       ) = 'on'
       AND current_database() = 'yellowflex_restore_test'
       AND (
           inet_server_port() = 55432
           OR (
               inet_server_port() = 55433
               AND current_setting('cluster_name')
                   = 'yellowflex-yf003v21-disposable'
           )
       )
       AND (
           EXISTS (
               SELECT 1
               FROM public."FoodPayrollBatch"
               WHERE "id" = p_batch
               AND "payrollReference" LIKE 'QA-FIXTURE-%'
           )
           OR (
               p_batch IS NULL
               AND p_key LIKE 'qa-fixture-%'
           )
       )
$function$;

REVOKE ALL ON FUNCTION
public.food_payroll_qa_fixture_cleanup(text,text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
public.food_payroll_qa_fixture_cleanup(text,text)
TO yf_platform_app;

SET LOCAL yellowflex.qa_fixture_cleanup = 'on';

DO $$
BEGIN
    IF public.food_payroll_qa_fixture_cleanup(
        NULL, 'qa-fixture-f520'
    ) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Limpieza QA autorizada no disponible';
    END IF;

    IF public.food_payroll_qa_fixture_cleanup(
        NULL, 'registro-real'
    ) IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'Marcador real aceptado';
    END IF;

    RAISE NOTICE 'PUERTO QA: 2/2 CONTROLES APROBADOS';
END $$;

SET LOCAL yellowflex.qa_fixture_cleanup = 'off';

DO $$
BEGIN
    IF public.food_payroll_qa_fixture_cleanup(
        NULL, 'qa-fixture-f520'
    ) IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'Limpieza sin autorizacion de sesion';
    END IF;

    RAISE NOTICE 'VARIABLE DE SESION: CONTROL APROBADO';
END $$;

RESET ROLE;

SET LOCAL ROLE yf_platform_qa_login;
SET LOCAL yellowflex.qa_fixture_cleanup = 'on';

DO $$
BEGIN
    IF public.food_payroll_qa_fixture_cleanup(
        NULL, 'qa-fixture-f520'
    ) IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'Aplicacion puede activar limpieza';
    END IF;

    RAISE NOTICE 'APLICACION RESTRINGIDA: CONTROL APROBADO';
END $$;

RESET ROLE;

SELECT 'INTEGRIDAD FINAL' AS seccion;

DO $$
BEGIN
    IF (SELECT count(*) FROM public."InventoryMovement") <> 478
       OR (SELECT count(*) FROM public."InventoryStockBalance") <> 475
       OR (SELECT count(*) FROM public."InventoryItem") <> 204
       OR (SELECT count(*) FROM public."Warehouse") <> 2
       OR (SELECT count(*) FROM public."User") <> 14
       OR (SELECT count(*) FROM public."Employee") <> 94
       OR (SELECT count(*) FROM public."FoodPayrollBatch") <> 0
       OR (SELECT count(*) FROM public."FoodPayrollAdjustment") <> 0
       OR (SELECT count(*) FROM public."FoodPayrollReconciliation") <> 0
       OR (SELECT count(*) FROM public."_prisma_migrations") <> 32
       OR EXISTS (
           SELECT 1 FROM public.yf_stock_balance_differences()
       )
    THEN
        RAISE EXCEPTION 'Integridad incorrecta';
    END IF;
END $$;

SELECT code
FROM public."InventoryItem"
WHERE code LIKE 'LAB-%'
   OR code LIKE 'QA-%'
ORDER BY code;

SELECT
    (SELECT count(*) FROM public."InventoryMovement") AS movimientos,
    (SELECT count(*) FROM public."InventoryStockBalance") AS saldos,
    (SELECT count(*) FROM public.yf_stock_balance_differences()) AS r8;


RESET ROLE;
RESET search_path;

SELECT 'F5-20-C1 CONFIGURACION INSTALADA' AS resultado;

RESET ROLE;
RESET search_path;

COMMIT;

