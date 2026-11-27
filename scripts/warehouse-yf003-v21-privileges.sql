-- Ejecutar una vez en cada base autorizada, después de la migración,
-- como propietario de los objetos, con los roles previamente provisionados.
BEGIN;
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
    THEN RAISE EXCEPTION 'Rol % con privilegios o membresías incompatibles', r.rolname;
    END IF;
  END LOOP;
  IF has_schema_privilege('yf_warehouse_app', 'public', 'CREATE')
     OR has_parameter_privilege('yf_warehouse_app', 'session_replication_role', 'SET')
     OR has_database_privilege('yf_warehouse_app', current_database(), 'CREATE')
  THEN RAISE EXCEPTION 'Revoque CREATE y SET efectivos de la aplicación antes de continuar'; END IF;
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
  THEN RAISE EXCEPTION 'La aplicación conserva EXECUTE sobre funciones internas'; END IF;
END $$;
COMMIT;