/* eslint-disable @typescript-eslint/no-require-imports */
// YF-003 V2 · Pruebas de la segunda intervención contra PostgreSQL aislado (127.0.0.1:55432/yellowflex_restore_test):
// historiales append-only (también con la variable de limpieza activa), existencia materializada exacta, vínculo explícito
// custodia ↔ movimiento, catálogo (permiso, duplicados, unidad, inactivación, concurrencia) y excepciones históricas R3.
// Rutas API reales + repositorios reales + PostgreSQL real. Fixtures con marcador QA-WH-V2-<uuid>; limpieza total.
// Los registros "reales" (sin marcador) se crean SOLO dentro de transacciones que se revierten al final de cada prueba.
// RUN_WAREHOUSE_YF003_DB_TESTS=1 node --require ./tests/helpers/server-only-register.cjs --import tsx --test tests/warehouse-yf003-v2-postgres.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('./helpers/isolated-postgres.cjs');
const { installRouteSession, setSessionUser } = require('./helpers/route-session.cjs');

const HISTORY_TABLES = ['InventoryMovement', 'InventoryCustodyEvent', 'InventoryCustodyOperation', 'WarehouseStockOperation',
  'WarehouseDiscrepancyEvent', 'WarehouseCatalogAudit', 'WarehouseReconciliationException'];

test('YF-003 V2: append-only, existencia materializada, vínculos de custodia, catálogo y excepciones históricas', {
  skip: process.env.RUN_WAREHOUSE_YF003_DB_TESTS !== '1', timeout: 900000,
}, async (t) => {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  const marker = `QA-WH-V2-${randomUUID()}`;
  const ids = { users: [], warehouse: null, items: [], extraItems: [] };
  const results = [];
  const ok = (id, name) => { results.push(id); t.diagnostic(`ESCENARIO OK ${id}: ${name}`); };
  /** Cliente SQL directo para pruebas de base de datos; cada prueba "real" corre en una transacción que se revierte. */
  const sql = new Client({ connectionString: url });
  await sql.connect();
  const rejects = async (statement, params, pattern, label) => {
    await sql.query('SAVEPOINT s');
    try { await sql.query(statement, params); assert.fail(`${label}: la base de datos aceptó la operación`); }
    catch (e) { if (e.code === 'ERR_ASSERTION') throw e; assert.match(String(e.message), pattern, `${label}: ${e.message}`); }
    finally { await sql.query('ROLLBACK TO SAVEPOINT s'); }
  };
  try {
    await assertIsolatedIdentity(db);
    globalThis.prisma = db;
    installRouteSession();
    const [warehouseArea, productionArea] = await Promise.all([
      db.operationalArea.findUnique({ where: { code: 'ALMACEN' } }), db.operationalArea.findUnique({ where: { code: 'PRODUCCION' } })]);
    assert.ok(warehouseArea?.active && productionArea?.active, 'Faltan los catálogos estructurales ALMACEN y PRODUCCION; no se modifican');

    const route = p => require(`../app/api/${p}/route.ts`);
    const R = {
      receipts: route('warehouse/movements'), transfers: route('warehouse/movements/transfers'), handoffs: route('warehouse/movements/handoffs'),
      reverse: route('warehouse/movements/[movementId]/reverse'), receive: route('warehouse/custodies/[custodyId]/receive'),
      ret: route('warehouse/custodies/[custodyId]/return'), retReceive: route('warehouse/returns/[custodyId]/receive'),
      recon: route('warehouse/reports/reconciliation'), exceptions: route('warehouse/reports/reconciliation/exceptions'), stock: route('warehouse/reports/stock'),
      items: route('warehouse/catalog/items'), item: route('warehouse/catalog/items/[itemId]'), locations: route('warehouse/catalog/locations'),
      location: route('warehouse/catalog/locations/[locationId]'), history: route('warehouse/catalog/history'), cpPerms: route('admin/cpanel/permissions'),
      inventory: route('warehouse/inventory'),
    };
    const api = async (userId, mod, method, { body, key, params, query = '' } = {}) => {
      setSessionUser(userId);
      const headers = { 'content-type': 'application/json' };
      if (key) headers['Idempotency-Key'] = key;
      const req = new Request(`http://qa.local/api${query}`, { method, headers, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body) });
      const res = await mod[method](req, { params: Promise.resolve(params ?? {}) });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text.replace(/^﻿/, '')); } catch { json = null; }
      return { status: res.status, json, text };
    };
    const K = () => randomUUID();
    const mkUser = async (label, roles, grants = [], legacy = null) => {
      const u = await db.user.create({ data: { name: `${marker}-${label}`, email: `${label}.${marker}@example.invalid`.toLowerCase(), passwordMustChange: false,
        roles: { create: roles.map(role => ({ role })) } } });
      ids.users.push(u.id);
      if (grants.length) await db.corporateModulePermission.createMany({ data: grants.map(g => {
        const [moduleKey, actionKey] = g.includes('/') ? g.split('/') : ['warehouse', g];
        return { userId: u.id, moduleKey, actionKey, granted: true };
      }) });
      if (legacy) await db.warehousePermission.create({ data: { userId: u.id, ...legacy } });
      return u.id;
    };
    const VIEW = { canViewInventory: true };
    const U = {
      operador: await mkUser('operador', ['EMPLEADO'], ['view', 'operate'], { ...VIEW, canRegisterMovement: true }),
      supervisor: await mkUser('supervisor', ['EMPLEADO'], ['view', 'operate'], { ...VIEW, canManageWarehouse: true }),
      aprobador: await mkUser('aprobador', ['EMPLEADO'], ['view', 'approve'], { ...VIEW, canApproveWarehouseAdjustments: true }),
      produccion: await mkUser('produccion', ['PRODUCCION'], ['view', 'operate']),
      catalogo: await mkUser('catalogo', ['EMPLEADO'], ['view', 'manage-catalog'], { ...VIEW, canManageCatalog: true }),
      catalogoSinBandera: await mkUser('catalogo-sin-bandera', ['EMPLEADO'], ['view', 'manage-catalog'], VIEW),
      banderaSinCpanel: await mkUser('bandera-sin-cpanel', ['EMPLEADO'], ['view'], { ...VIEW, canManageCatalog: true }),
      consulta: await mkUser('consulta', ['EMPLEADO'], ['view'], VIEW),
      auditor: await mkUser('auditor', ['EMPLEADO'], ['audit']),
      admin: await mkUser('admin', ['ADMIN']),
      direccion: await mkUser('direccion', ['DIRECCION'], ['view'], VIEW),
      rh: await mkUser('rh-delegado', ['RH'], ['c-panel/manage']),
      objetivo: await mkUser('objetivo', ['EMPLEADO'], ['view'], VIEW),
    };
    const wh = await db.warehouse.create({ data: { code: marker.slice(0, 40), name: `${marker} almacén` } }); ids.warehouse = wh.id;
    const mkLoc = code => db.warehouseLocation.create({ data: { warehouseId: wh.id, code, name: `${marker} ${code}` } });
    const [L1, L2, L3, L4, L5] = [await mkLoc('V2-A'), await mkLoc('V2-B'), await mkLoc('V2-C'), await mkLoc('V2-D'), await mkLoc('V2-E')];
    const mkItem = async (suffix, unit = 'PZ') => { const i = await db.inventoryItem.create({ data: { code: `${marker}-${suffix}`, description: `${marker} ${suffix}`, baseUnit: unit } }); ids.items.push(i.id); return i; };
    const I1 = await mkItem('A'); const I2 = await mkItem('B', 'KG'); const I3 = await mkItem('C');
    const { getWarehouseStockBalance } = require('../repositories/warehouse-stock-lock.ts');
    const bal = async (item, loc) => (await getWarehouseStockBalance(db, item.id, loc.id)).toString();
    const mat = async (item, loc) => (await db.inventoryStockBalance.findUnique({ where: { itemId_locationId: { itemId: item.id, locationId: loc.id } } }))?.quantity.toString() ?? '0';
    const receipt = (user, item, loc, quantity, key = K()) => api(user, R.receipts, 'POST', { key, body: { itemId: item.id, destinationLocationId: loc.id, quantity, referenceType: 'QA', referenceNumber: marker } });
    const transfer = (user, item, from, to, quantity, key = K()) => api(user, R.transfers, 'POST', { key, body: { itemId: item.id, originLocationId: from.id, destinationLocationId: to.id, quantity } });
    const handoff = (user, item, loc, quantity, key = K()) => api(user, R.handoffs, 'POST', { key, body: { itemId: item.id, originLocationId: loc.id, quantity, referenceType: 'OP', referenceNumber: `${marker}-OP` } });

    // ======================================================== V01–V09 Historiales append-only (P0)
    {
      assert.equal((await receipt(U.operador, I1, L1, '10')).status, 201);
      const fixtureMov = await db.inventoryMovement.findFirst({ where: { itemId: I1.id } });
      await sql.query('BEGIN');
      try {
        // Datos con apariencia REAL (sin marcador QA): existen solo dentro de esta transacción, que se revierte.
        const real = `RL${randomUUID().slice(0, 8)}`;
        await sql.query(`INSERT INTO "User" ("id","name","email","updatedAt") VALUES ($1, 'Operador Planta ' || $1, lower($1) || '@yellowflex.invalid', now())`, [`${real}-U`]);
        await sql.query(`INSERT INTO "InventoryItem" ("id","code","description","baseUnit","updatedAt") VALUES ($1, $1, 'Materia prima real', 'PZ', now())`, [`${real}-I`]);
        await sql.query(`INSERT INTO "InventoryMovement" ("id","folio","itemId","type","quantity","unit","destinationLocationId","occurredAt","actorId")
          VALUES ($1,$1,$2,'EXTERNAL_RECEIPT',5,'PZ',$3,now(),$4)`, [`${real}-M`, `${real}-I`, L1.id, `${real}-U`]);
        await sql.query(`INSERT INTO "InventoryCustody" ("id","folio","itemId","quantity","unit","custodianAreaId","status","enteredAt","createdById","updatedAt")
          VALUES ($1,$1,$2,1,'PZ',$3,'AVAILABLE',now(),$4,now())`, [`${real}-C`, `${real}-I`, productionArea.id, `${real}-U`]);
        await sql.query(`INSERT INTO "InventoryCustodyEvent" ("id","custodyId","type","quantity","occurredAt","actorId") VALUES ($1,$2,'CREATED',1,now(),$3)`, [`${real}-E`, `${real}-C`, `${real}-U`]);
        await sql.query(`INSERT INTO "InventoryCustodyOperation" ("id","operationKey","operationPayloadHash","custodyId","kind","actorId") VALUES ($1,$1,'h',$2,(SELECT enumlabel::text FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='InventoryCustodyOperationKind' LIMIT 1)::"InventoryCustodyOperationKind",$3)`, [`${real}-O`, `${real}-C`, `${real}-U`]);
        await sql.query(`INSERT INTO "WarehouseStockOperation" ("id","operationKey","operationPayloadHash","kind","actorId") VALUES ($1,$1,'h','INTERNAL_TRANSFER',$2)`, [`${real}-S`, `${real}-U`]);
        await sql.query(`INSERT INTO "WarehouseCount" ("id","folio","itemId","locationId","type","expectedQuantity","launchedAt","createdById","updatedAt")
          VALUES ($1,$1,$2,$3,(SELECT enumlabel::text FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='WarehouseCountType' LIMIT 1)::"WarehouseCountType",5,now(),$4,now())`, [`${real}-K`, `${real}-I`, L1.id, `${real}-U`]);
        await sql.query(`INSERT INTO "WarehouseDiscrepancy" ("id","folio","countId","updatedAt") VALUES ($1,$1,$2,now())`, [`${real}-D`, `${real}-K`]);
        await sql.query(`INSERT INTO "WarehouseDiscrepancyEvent" ("id","discrepancyId","type","actorId") VALUES ($1,$2,'CREATED',$3)`, [`${real}-DE`, `${real}-D`, `${real}-U`]);
        await sql.query(`INSERT INTO "WarehouseCatalogAudit" ("id","entityType","entityId","action","reason","actorId") VALUES ($1,'ITEM',$2,'CREATE','alta real de prueba',$3)`, [`${real}-CA`, `${real}-I`, `${real}-U`]);
        await sql.query(`INSERT INTO "WarehouseReconciliationException" ("id","checkCode","subjectType","subjectId","reason","actorId") VALUES ($1,'R3','MOVEMENT',$2,'excepción real de prueba documentada',$3)`, [`${real}-X`, `${real}-M`, `${real}-U`]);
        const realRows = { InventoryMovement: `${real}-M`, InventoryCustodyEvent: `${real}-E`, InventoryCustodyOperation: `${real}-O`, WarehouseStockOperation: `${real}-S`,
          WarehouseDiscrepancyEvent: `${real}-DE`, WarehouseCatalogAudit: `${real}-CA`, WarehouseReconciliationException: `${real}-X` };
        const setMarker = v => sql.query("SELECT set_config('yellowflex.fixture_cleanup', $1, true)", [v]);
        for (const value of ['on', '*', '%', 'QA-', 'QA-%', 'true', real, `${real}-I`]) {
          await setMarker(value);
          for (const [table, id] of Object.entries(realRows)) await rejects(`DELETE FROM "${table}" WHERE "id" = $1`, [id], /YF_APPEND_ONLY/, `${table} con '${value}'`);
        }
        ok('V01', `DELETE de registros sin marcador rechazado en los 7 historiales con 'on', comodines, 'QA-' a secas y el propio código real (${7 * 8} intentos)`);
        await setMarker('QA-WH-OTRA-PRUEBA-123456');
        for (const [table, id] of Object.entries(realRows)) await rejects(`DELETE FROM "${table}" WHERE "id" = $1`, [id], /YF_APPEND_ONLY/, `${table} con marcador ajeno`);
        await rejects(`DELETE FROM "InventoryMovement" WHERE "id" = $1`, [fixtureMov.id], /YF_APPEND_ONLY/, 'fixture de otra prueba');
        ok('V02', 'un marcador QA válido de otra prueba no elimina registros reales ni fixtures de esta prueba');
        await setMarker(marker);
        for (const [table, id] of Object.entries(realRows)) {
          await rejects(`DELETE FROM "${table}" WHERE "id" = $1`, [id], /YF_APPEND_ONLY/, `${table} real con el marcador correcto`);
          await rejects(`UPDATE "${table}" SET "actorId" = "actorId" WHERE "id" = $1`, [id], /YF_APPEND_ONLY/, `${table} UPDATE`);
        }
        await rejects(`UPDATE "InventoryMovement" SET "quantity" = 999 WHERE "id" = $1`, [fixtureMov.id], /YF_APPEND_ONLY/, 'UPDATE de fixture');
        ok('V03', 'con el marcador correcto los registros reales siguen protegidos y UPDATE se rechaza siempre (también sobre fixtures)');
        for (const table of HISTORY_TABLES.concat('InventoryStockBalance')) await rejects(`TRUNCATE "${table}" CASCADE`, [], /YF_APPEND_ONLY|TRUNCATE/, `TRUNCATE ${table}`);
        ok('V04', 'TRUNCATE rechazado en los 7 historiales y en la existencia materializada');
        await setMarker('');
        await rejects(`DELETE FROM "InventoryMovement" WHERE "itemId" = $1`, [I1.id], /YF_APPEND_ONLY/, 'fixture sin declarar marcador');
        ok('V05', 'sin declarar el marcador ni siquiera los fixtures se pueden eliminar');
        // Variable de sesión fuera de la base aislada: la misma función devuelve cero marcadores.
        const fnText = readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20261125200000_warehouse_yf003_enterprise_v2', 'migration.sql'), 'utf8')
          .match(/CREATE OR REPLACE FUNCTION "yf_fixture_markers"\(\)[\s\S]*?END \$\$;/)[0].replace('CREATE OR REPLACE FUNCTION "yf_fixture_markers"', 'CREATE FUNCTION pg_temp.yf_fixture_markers');
        const other = new Client({ connectionString: url.replace(/\/yellowflex_restore_test$/, '/postgres') });
        await other.connect();
        try {
          await other.query(fnText);
          const r = await other.query("SELECT set_config('yellowflex.fixture_cleanup', $1, false), pg_temp.yf_fixture_markers() AS m, current_database() AS db", [marker]);
          assert.equal(r.rows[0].db, 'postgres'); assert.deepEqual(r.rows[0].m, []);
        } finally { await other.end(); }
        ok('V06', 'en otra base de datos la misma función no reconoce ningún marcador (la variable de sesión sola no basta)');
        // The restricted role is provisioned before running the disposable matrix.
        await sql.query('SET LOCAL ROLE yf_warehouse_app');
        await sql.query("SELECT set_config('yellowflex.balance_rebuild', 'on', true)");
        await rejects('SELECT public."yf_stock_balance_apply"($1,$2,1)', [I1.id, L1.id], /permission denied/, 'función interna');
        await rejects('SELECT public."yf_rebuild_inventory_stock_balance"()', [], /permission denied/, 'reconstrucción sin autorización');
        await rejects('ALTER TABLE public."InventoryMovement" DISABLE TRIGGER "InventoryMovement_stock_balance"', [], /must be owner|permission denied/, 'desactivar trigger');
        await rejects("SET LOCAL session_replication_role = 'replica'", [], /permission denied/, 'parámetro restringido');
        await rejects('TRUNCATE public."InventoryStockBalance"', [], /permission denied/, 'truncate sin privilegio');
        await rejects('DELETE FROM public."InventoryMovement" WHERE "id" = $1', [real + '-M'], /permission denied|YF_APPEND_ONLY/, 'limpieza sin privilegio');
        await rejects(`INSERT INTO "InventoryStockBalance" ("itemId","locationId","quantity","updatedAt") VALUES ($1,$2,1,now())`, [I3.id, L4.id], /YF_STOCK_BALANCE|permission denied/, 'INSERT directo en saldos');
        await rejects(`UPDATE "InventoryStockBalance" SET "quantity" = "quantity" + 1 WHERE "itemId" = $1`, [I1.id], /YF_STOCK_BALANCE|permission denied/, 'UPDATE directo en saldos');
        await rejects(`DELETE FROM "InventoryStockBalance" WHERE "itemId" = $1 AND "quantity" <> 0`, [I1.id], /YF_STOCK_BALANCE|permission denied/, 'DELETE de saldo con existencia');
        await sql.query('RESET ROLE');
        await sql.query('UPDATE public."User" SET "name" = $1 WHERE "id" = $2', [marker, real + '-U']);
        await setMarker(marker);
        await rejects('DELETE FROM public."WarehouseStockOperation" WHERE "id" = $1', [real + '-S'], /YF_APPEND_ONLY/, 'nombre visible no identifica fixture');
        ok('V07', 'la existencia materializada no admite escrituras directas: solo el disparador del libro mayor o la reconstrucción controlada');
      } finally { await sql.query('ROLLBACK'); }
      assert.equal(await db.user.count({ where: { name: { startsWith: 'Operador Planta RL' } } }), 0, 'los registros reales de prueba se revirtieron');
      // Rollback de una transacción con movimientos: la existencia materializada no cambia.
      const before = await mat(I1, L1);
      await sql.query('BEGIN');
      await sql.query(`INSERT INTO "InventoryMovement" ("id","folio","itemId","type","quantity","unit","destinationLocationId","occurredAt","actorId") VALUES ($1,$1,$2,'EXTERNAL_RECEIPT',7,'PZ',$3,now(),$4)`, [`${marker}-RB`, I1.id, L1.id, U.operador]);
      assert.equal((await sql.query(`SELECT "quantity"::text q FROM "InventoryStockBalance" WHERE "itemId"=$1 AND "locationId"=$2`, [I1.id, L1.id])).rows[0].q, '17.000');
      await sql.query('ROLLBACK');
      assert.equal(await mat(I1, L1), before);
      await assert.rejects(sql.query(`INSERT INTO "InventoryMovement" ("id","folio","itemId","type","quantity","unit","destinationLocationId","occurredAt","actorId") VALUES ($1,$1,$2,'EXTERNAL_RECEIPT',-3,'PZ',$3,now(),$4)`, [`${marker}-NEG`, I1.id, L1.id, U.operador]), /quantity_positive/);
      assert.equal(await mat(I1, L1), before);
      ok('V08', 'transacción revertida o movimiento inválido: la existencia materializada no cambia (misma transacción que el libro mayor)');
      // Eliminación de fixtures permitida solo con el marcador de ESTA prueba.
      await sql.query('BEGIN');
      await sql.query("SELECT set_config('yellowflex.fixture_cleanup', $1, true)", [marker]);
      const del = await sql.query(`DELETE FROM "InventoryMovement" WHERE "id" = $1`, [fixtureMov.id]);
      assert.equal(del.rowCount, 1);
      assert.equal((await sql.query(`SELECT COALESCE((SELECT "quantity"::text FROM "InventoryStockBalance" WHERE "itemId"=$1 AND "locationId"=$2), '0') q`, [I1.id, L1.id])).rows[0].q, '0.000');
      await sql.query('ROLLBACK');
      assert.equal(await mat(I1, L1), '10');
      ok('V09', 'con el marcador de la prueba sí se eliminan sus fixtures y la existencia materializada se ajusta en la misma transacción');
    }

    // ======================================================== V10–V12 Existencia materializada = libro mayor
    {
      assert.equal((await receipt(U.operador, I2, L1, '50.125')).status, 201);
      const opp = await Promise.all(Array.from({ length: 24 }, (_, i) => transfer(U.operador, I2, i % 2 ? L1 : L2, i % 2 ? L2 : L1, '1.005')));
      assert.ok(opp.every(r => r.status === 201 || r.status === 409), JSON.stringify(opp.filter(r => r.status !== 201 && r.status !== 409).map(r => r.text)));
      for (const [item, loc] of [[I2, L1], [I2, L2], [I1, L1]]) assert.equal(await mat(item, loc), await bal(item, loc), `${item.code} ${loc.code}`);
      ok('V10', `24 transferencias opuestas simultáneas: sin interbloqueos (${opp.filter(r => r.status === 201).length} aceptadas) y existencia materializada = libro mayor`);
      const [diff] = await db.$queryRawUnsafe('SELECT COUNT(*)::int n FROM "yf_stock_balance_differences"()');
      assert.equal(diff.n, 0);
      const recon = await api(U.auditor, R.recon, 'GET');
      const r8 = recon.json.findings.find(f => f.check.startsWith('R8'));
      assert.equal(r8.count, 0);
      ok('V11', 'reconciliación R8 exacta: cero diferencias entre existencia materializada y libro mayor en toda la base aislada');
      const maintenance = new Client({ connectionString: url });
      await maintenance.connect();
      let rebuilt;
      try {
        await sql.query('BEGIN');
        await maintenance.query('BEGIN');
        await maintenance.query('SET LOCAL ROLE yf_warehouse_maintenance');
        await maintenance.query("SET LOCAL lock_timeout = '300ms'");
        await sql.query('SET LOCAL ROLE yf_warehouse_app');
        const concurrentId = marker + '-REBUILD';
        await sql.query('INSERT INTO public."InventoryMovement" ("id","folio","itemId","type","quantity","unit","destinationLocationId","occurredAt","actorId") VALUES ($1,$1,$2,$3,1,$4,$5,now(),$6)',
          [concurrentId, I1.id, 'EXTERNAL_RECEIPT', 'PZ', L4.id, U.operador]);
        await assert.rejects(maintenance.query('SELECT public."yf_rebuild_inventory_stock_balance"()'), { code: '55P03' });
        await maintenance.query('ROLLBACK');
        await sql.query('COMMIT');
        await maintenance.query('BEGIN');
        await maintenance.query('SET LOCAL ROLE yf_warehouse_maintenance');
        [rebuilt] = (await maintenance.query('SELECT public."yf_rebuild_inventory_stock_balance"() AS n')).rows;
        await maintenance.query('COMMIT');
        assert.equal(await mat(I1, L1), await bal(I1, L1));
        assert.equal(await mat(I1, L4), await bal(I1, L4));
        await sql.query('BEGIN');
        await sql.query("SELECT set_config('yellowflex.fixture_cleanup', $1, true)", [marker]);
        await sql.query('DELETE FROM public."InventoryMovement" WHERE "id" = $1', [concurrentId]);
        await sql.query('COMMIT');
        assert.equal((await sql.query('SELECT count(*)::int AS n FROM public."yf_stock_balance_differences"()')).rows[0].n, 0);
      } finally {
        await sql.query('ROLLBACK');
        await maintenance.end();
      }
      assert.ok(Number(rebuilt.n) >= 2);
      assert.equal(await mat(I2, L1), await bal(I2, L1));
      ok('V12', `reconstrucción controlada: ${rebuilt.n} saldos reconstruidos desde el libro mayor y verificados sin diferencias`);
    }

    // ======================================================== V13–V17 Vínculo explícito custodia ↔ movimiento
    {
      await receipt(U.operador, I2, L3, '20');
      const h = await handoff(U.operador, I2, L3, '6'); assert.equal(h.status, 201, h.text);
      const hm = await db.inventoryMovement.findUnique({ where: { folio: h.json.movement.folio } });
      const c = await db.inventoryCustody.findUnique({ where: { folio: h.json.custody.folio } });
      assert.equal(c.sourceMovementId, hm.id);
      await assert.rejects(db.inventoryCustody.create({ data: { folio: `${marker}-DUP`, itemId: I2.id, quantity: 1, unit: 'KG', custodianAreaId: productionArea.id, status: 'AVAILABLE', enteredAt: new Date(), createdById: U.operador, sourceMovementId: hm.id } }));
      ok('V13', 'la entrega crea su custodia con vínculo explícito y único al movimiento (una segunda custodia con el mismo movimiento se rechaza)');
      assert.equal((await api(U.produccion, R.receive, 'POST', { key: K(), params: { custodyId: c.id }, body: { receivedQuantity: '6' } })).status, 201);
      const part = await api(U.produccion, R.ret, 'POST', { key: K(), params: { custodyId: c.id }, body: { quantity: '2' } });
      assert.equal(part.status, 201, part.text); assert.equal(part.json.partial, true);
      const child = await db.inventoryCustody.findFirst({ where: { parentCustodyId: c.id } });
      assert.ok(child, 'la devolución parcial crea una custodia hija vinculada a su custodia de origen');
      const rr = await api(U.operador, R.retReceive, 'POST', { key: K(), params: { custodyId: child.id }, body: { receivedQuantity: '2', destinationLocationId: L3.id } });
      assert.equal(rr.status, 201, rr.text);
      const childAfter = await db.inventoryCustody.findUnique({ where: { id: child.id } });
      const back = await db.inventoryMovement.findUnique({ where: { folio: rr.json.movementFolio } });
      assert.equal(childAfter.closingMovementId, back.id); assert.equal(back.type, 'OPERATIONAL_RETURN');
      ok('V14', 'recepción, devolución parcial (custodia hija con parentCustodyId) y regreso a Almacén (closingMovementId) quedan vinculados');
      const total = await api(U.produccion, R.ret, 'POST', { key: K(), params: { custodyId: c.id }, body: {} });
      assert.equal(total.status, 201); assert.equal(total.json.partial, false);
      const rr2 = await api(U.operador, R.retReceive, 'POST', { key: K(), params: { custodyId: c.id }, body: { receivedQuantity: '4', destinationLocationId: L3.id } });
      assert.equal(rr2.status, 201, rr2.text);
      const cAfter = await db.inventoryCustody.findUnique({ where: { id: c.id } });
      assert.equal(cAfter.status, 'CLOSED'); assert.equal(cAfter.closingMovementId, (await db.inventoryMovement.findUnique({ where: { folio: rr2.json.movementFolio } })).id);
      ok('V15', 'devolución total: la custodia de origen se cierra con su movimiento de regreso vinculado');
      const hx = await handoff(U.operador, I2, L3, '1'); const hxm = await db.inventoryMovement.findUnique({ where: { folio: hx.json.movement.folio } });
      const cancel = await api(U.supervisor, R.reverse, 'POST', { key: K(), params: { movementId: hxm.id }, body: { reason: 'Entrega registrada por error' } });
      assert.equal(cancel.status, 201, cancel.text);
      const hxc = await db.inventoryCustody.findUnique({ where: { sourceMovementId: hxm.id } });
      const back2 = await db.inventoryMovement.findUnique({ where: { folio: cancel.json.reversal.reversalFolio } });
      assert.equal(hxc.status, 'CLOSED'); assert.equal(hxc.closingMovementId, back2.id);
      ok('V16', 'cancelación de una entrega no recibida: localiza la custodia por el vínculo y la cierra con el movimiento de regreso');
      // Entrega histórica sin custodia (simulación de un dato heredado): no se cancela por coincidencia y se reporta en R7.
      await receipt(U.operador, I3, L4, '5');
      const legacy = await db.inventoryMovement.create({ data: { folio: `${marker}-LEG`, itemId: I3.id, type: 'OPERATIONAL_HANDOFF', quantity: 2, unit: 'PZ', originLocationId: L4.id, occurredAt: new Date(), actorId: U.operador, referenceNumber: `${marker}-LEG` } });
      const orphanCustody = await db.inventoryCustody.create({ data: { folio: `${marker}-HUERFANA`, itemId: I3.id, quantity: 3, unit: 'PZ', custodianAreaId: productionArea.id, status: 'AVAILABLE', enteredAt: new Date(Date.now() - 86400000), createdById: U.operador } });
      const legacyCancel = await api(U.supervisor, R.reverse, 'POST', { key: K(), params: { movementId: legacy.id }, body: { reason: 'Intento sobre dato heredado' } });
      assert.equal(legacyCancel.status, 409, legacyCancel.text);
      const recon = await api(U.auditor, R.recon, 'GET');
      const r7a = recon.json.findings.find(f => f.check === 'R7 entrega sin custodia vinculada');
      const r7b = recon.json.findings.find(f => f.check === 'R7 custodia sin movimiento de entrega vinculado');
      assert.ok(r7a.sample.some(s => s.folio === legacy.folio)); assert.ok(r7b.sample.some(s => s.folio === orphanCustody.folio));
      assert.equal(await bal(I3, L4), '3');
      ok('V17', 'datos heredados sin vínculo: la cancelación se rechaza (no se adivina la custodia) y R7 reporta la entrega y la custodia huérfanas');

      // ==================================================== V18 Excepción histórica documentada (R3/R7) sin alterar historia
      const body = { movementId: legacy.id, reason: 'Entrega heredada de 2025 sin custodia; se revisó vale físico y bitácora de Producción.' };
      assert.equal((await api(U.consulta, R.exceptions, 'POST', { body })).status, 403);
      assert.equal((await api(U.aprobador, R.exceptions, 'POST', { body: { ...body, reason: 'corto' } })).status, 409);
      assert.equal((await api(U.aprobador, R.exceptions, 'POST', { body: { ...body, movementId: hm.id } })).status, 409, 'una entrega con custodia no requiere excepción');
      const movBefore = await db.inventoryMovement.count(); const custBefore = await db.inventoryCustody.count();
      const doc = await api(U.aprobador, R.exceptions, 'POST', { body: { ...body, evidence: 'Vale 4471' } });
      assert.equal(doc.status, 201, doc.text);
      assert.equal((await api(U.aprobador, R.exceptions, 'POST', { body })).status, 409, 'no se documenta dos veces');
      assert.equal(await db.inventoryMovement.count(), movBefore); assert.equal(await db.inventoryCustody.count(), custBefore);
      const recon2 = await api(U.auditor, R.recon, 'GET');
      assert.ok(!recon2.json.findings.find(f => f.check === 'R7 entrega sin custodia vinculada').sample.some(s => s.folio === legacy.folio));
      assert.ok(recon2.json.findings.find(f => f.check.startsWith('Excepciones')).sample.some(s => s.folio === legacy.folio));
      await assert.rejects(db.$executeRawUnsafe(`UPDATE "WarehouseReconciliationException" SET "reason" = 'x' WHERE "id" = $1`, doc.json.exception.id), /YF_APPEND_ONLY/);
      ok('V18', 'excepción histórica documentada: requiere autorización y motivo, no crea custodias ni movimientos, sale de R7, queda visible e inmutable');
      const actorDoc = await mkUser('aprobador-operador', ['EMPLEADO'], ['view', 'operate', 'approve'], { ...VIEW, canRegisterMovement: true, canApproveWarehouseAdjustments: true });
      await receipt(actorDoc, I3, L4, '1');
      const own = await db.inventoryMovement.create({ data: { folio: `${marker}-LEG2`, itemId: I3.id, type: 'OPERATIONAL_HANDOFF', quantity: 1, unit: 'PZ', originLocationId: L4.id, occurredAt: new Date(), actorId: actorDoc } });
      assert.equal((await api(actorDoc, R.exceptions, 'POST', { body: { movementId: own.id, reason: body.reason } })).status, 409, 'quien registró la entrega no documenta su excepción');
      ok('V19', 'segregación: quien registró la entrega no puede documentar su propia excepción');
      ids.orphanCustody = orphanCustody.id;
    }

    // ======================================================== V20–V24 Permiso sensible de catálogo
    {
      const newItem = { code: `${marker}-NUEVO`.slice(0, 50), description: 'Artículo de catálogo QA', baseUnit: 'PZ', reason: 'Alta de prueba de catálogo' };
      for (const u of [U.consulta, U.catalogoSinBandera, U.banderaSinCpanel, U.admin, U.direccion, U.auditor, U.operador]) {
        assert.equal((await api(u, R.items, 'GET')).status, 403, `GET ${u}`);
        assert.equal((await api(u, R.items, 'POST', { body: newItem })).status, 403, `POST ${u}`);
        assert.equal((await api(u, R.item, 'PATCH', { params: { itemId: I1.id }, body: { description: 'x'.repeat(5), reason: 'cambio no autorizado' } })).status, 403);
        assert.equal((await api(u, R.location, 'PATCH', { params: { locationId: L1.id }, body: { active: false, reason: 'cambio no autorizado' } })).status, 403);
      }
      assert.equal((await api(null, R.items, 'GET')).status, 401);
      ok('V20', 'catálogo sin permiso: consulta, operador, auditor, ADMIN y Dirección (sin concesión explícita) y concesiones incompletas → 403; sin sesión → 401');
      const grant = (actor, moduleKey, granted = true) => api(actor, R.cpPerms, 'PATCH', { body: { userId: U.objetivo, moduleKey, actionKey: 'manage-catalog', granted, reason: 'Prueba de permiso de catálogo' } });
      assert.equal((await grant(U.rh, 'warehouse')).status, 403, 'RH delegado no concede el permiso sensible');
      assert.equal((await grant(U.admin, 'purchases')).status, 422, 'acción exclusiva de Almacén');
      assert.equal((await grant(U.admin, 'warehouse')).status, 200);
      assert.equal((await api(U.objetivo, R.items, 'GET')).status, 403, 'la concesión C-PANEL sola no basta sin la bandera operativa');
      const audit = await db.corporatePermissionAudit.findFirst({ where: { targetId: U.objetivo, actionKey: 'manage-catalog' } });
      assert.ok(audit && audit.actorId === U.admin && audit.newGranted === true);
      assert.equal((await api(U.objetivo, R.cpPerms, 'PATCH', { body: { userId: U.objetivo, moduleKey: 'warehouse', actionKey: 'manage-catalog', granted: true, reason: 'autoasignación' } })).status, 403);
      ok('V21', 'permiso sensible manage-catalog: solo ADMIN lo concede, exclusivo de Almacén, auditado, no autoasignable y exige además la bandera operativa');
      const created = await api(U.catalogo, R.items, 'POST', { body: newItem });
      assert.equal(created.status, 201, created.text); ids.extraItems.push(created.json.item.id);
      const dupLower = await api(U.catalogo, R.items, 'POST', { body: { ...newItem, code: newItem.code.toLowerCase() } });
      assert.equal(dupLower.status, 409); assert.match(dupLower.json.error, /Ya existe/);
      const race = await Promise.all([1, 2, 3].map(() => api(U.catalogo, R.items, 'POST', { body: { ...newItem, code: `${marker}-RACE`.slice(0, 50) } })));
      assert.deepEqual(race.map(r => r.status).sort(), [201, 409, 409]); ids.extraItems.push(race.find(r => r.status === 201).json.item.id);
      assert.equal((await api(U.catalogo, R.items, 'POST', { body: { ...newItem, code: `${marker}-U`.slice(0, 50), baseUnit: 'LATA' } })).status, 409, 'unidad no válida');
      assert.equal((await api(U.catalogo, R.items, 'POST', { body: { ...newItem, code: 'X' } })).status, 409, 'código inválido');
      assert.equal((await api(U.catalogo, R.items, 'POST', { body: { ...newItem, code: `${marker}-SM`.slice(0, 50), reason: 'x' } })).status, 409, 'motivo obligatorio');
      ok('V22', 'alta de artículo: duplicados rechazados (también sin distinguir mayúsculas y en 3 altas simultáneas), unidad, código y motivo validados');
      const nid = created.json.item.id;
      const ed = await api(U.catalogo, R.item, 'PATCH', { params: { itemId: nid }, body: { description: 'Descripción corregida QA', reason: 'Corrección de descripción' } });
      assert.equal(ed.status, 200); assert.equal(ed.json.item.description, 'Descripción corregida QA');
      assert.equal((await api(U.catalogo, R.item, 'PATCH', { params: { itemId: nid }, body: { code: 'OTRO', reason: 'cambio de código' } })).status, 422);
      assert.equal((await api(U.catalogo, R.item, 'DELETE', { params: { itemId: nid } })).status, 405);
      assert.equal((await api(U.catalogo, R.item, 'PATCH', { params: { itemId: nid }, body: { baseUnit: 'KG', reason: 'Unidad corregida antes de usar' } })).status, 200, 'sin historial la unidad sí cambia');
      const unitWithHistory = await api(U.catalogo, R.item, 'PATCH', { params: { itemId: I1.id }, body: { baseUnit: 'KG', reason: 'Intento de cambio de unidad' } });
      assert.equal(unitWithHistory.status, 409); assert.match(unitWithHistory.json.error, /historial/);
      assert.equal((await db.inventoryItem.findUnique({ where: { id: I1.id } })).baseUnit, 'PZ');
      ok('V23', 'edición: descripción con motivo; el código no cambia; no se elimina (405); la unidad base no cambia si hay historial');
      const hist = await api(U.catalogo, R.history, 'GET', { query: `?entityType=ITEM&entityId=${nid}` });
      assert.deepEqual(hist.json.rows.map(r => r.action).sort(), ['CREATE', 'UPDATE', 'UPDATE']);
      assert.ok(hist.json.rows.every(r => r.actor === `${marker}-catalogo` && r.reason.length >= 8));
      assert.equal((await api(U.auditor, R.history, 'GET', { query: `?entityType=ITEM&entityId=${nid}` })).status, 200, 'auditoría consulta el historial');
      assert.equal((await api(U.consulta, R.history, 'GET', { query: `?entityType=ITEM&entityId=${nid}` })).status, 403);
      await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "WarehouseCatalogAudit" WHERE "entityId" = $1`, nid), /YF_APPEND_ONLY/);
      ok('V24', 'historial del catálogo: alta y ediciones con usuario, motivo, antes y después; consultable por Auditoría; inmutable');
    }

    // ======================================================== V25–V28 Inactivación protegida y concurrencia con movimientos
    {
      const stockBefore = await db.$queryRawUnsafe(`SELECT "itemId","locationId","quantity"::text q FROM "InventoryStockBalance" WHERE "itemId" = ANY($1) ORDER BY 1,2`, ids.items);
      const movBefore = await db.inventoryMovement.count({ where: { itemId: { in: ids.items } } });
      const withStock = await api(U.catalogo, R.item, 'PATCH', { params: { itemId: I1.id }, body: { active: false, reason: 'Inactivación con existencia' } });
      assert.equal(withStock.status, 409); assert.match(withStock.json.error, /existencia/);
      const withCustody = await api(U.catalogo, R.item, 'PATCH', { params: { itemId: I3.id }, body: { active: false, reason: 'Inactivación con custodia' } });
      assert.equal(withCustody.status, 409);
      const locStock = await api(U.catalogo, R.location, 'PATCH', { params: { locationId: L1.id }, body: { active: false, reason: 'Ubicación con material' } });
      assert.equal(locStock.status, 409); assert.match(locStock.json.error, /existencias/);
      await receipt(U.operador, I1, L5, '1');
      const ht = await handoff(U.operador, I1, L5, '1'); assert.equal(ht.status, 201);
      assert.equal(await bal(I1, L5), '0');
      const locTransit = await api(U.catalogo, R.location, 'PATCH', { params: { locationId: L5.id }, body: { active: false, reason: 'Ubicación con entrega en tránsito' } });
      assert.equal(locTransit.status, 409, locTransit.text); assert.match(locTransit.json.error, /custodias pendientes/);
      ok('V25', 'inactivación rechazada: artículo con existencia o custodia abierta; ubicación con material o con entrega en tránsito que podría regresar');
      const stockAfter = await db.$queryRawUnsafe(`SELECT "itemId","locationId","quantity"::text q FROM "InventoryStockBalance" WHERE "itemId" = ANY($1) ORDER BY 1,2`, ids.items);
      assert.equal(await db.inventoryMovement.count({ where: { itemId: { in: ids.items } } }), movBefore + 2);
      assert.deepEqual(stockAfter.filter(r => r.locationId !== L5.id), stockBefore.filter(r => r.locationId !== L5.id));
      ok('V26', 'las operaciones de catálogo no crean movimientos ni alteran existencias (solo cambian los movimientos operativos registrados aparte)');
      // Concurrencia determinista: el administrador del catálogo tiene la fila del artículo bloqueada mientras llega un movimiento.
      const free = await db.inventoryItem.create({ data: { code: `${marker}-CONC`, description: `${marker} concurrencia`, baseUnit: 'PZ' } }); ids.items.push(free.id);
      const lock = new Client({ connectionString: url }); await lock.connect();
      try {
        await lock.query('BEGIN');
        await lock.query(`SELECT 1 FROM "InventoryItem" WHERE "id" = $1 FOR UPDATE`, [free.id]);
        const pending = receipt(U.operador, free, L2, '3');
        await new Promise(r => setTimeout(r, 400));
        await lock.query(`UPDATE "InventoryItem" SET "active" = false, "updatedAt" = now() WHERE "id" = $1`, [free.id]);
        await lock.query('COMMIT');
        const res = await pending;
        assert.equal(res.status, 409, res.text); assert.match(res.json.error, /inactiv/i);
      } finally { await lock.end(); }
      assert.equal(await db.inventoryMovement.count({ where: { itemId: free.id } }), 0);
      assert.equal(await mat(free, L2), '0');
      ok('V27', 'inactivación simultánea: el movimiento que esperaba el bloqueo del catálogo se rechaza al ver el artículo inactivo; cero movimientos');
      await db.inventoryItem.update({ where: { id: free.id }, data: { active: true } });
      const races = [];
      for (let i = 0; i < 8; i += 1) {
        const it = await db.inventoryItem.create({ data: { code: `${marker}-R${i}`, description: `${marker} carrera ${i}`, baseUnit: 'PZ' } }); ids.items.push(it.id);
        const [mov, inact] = await Promise.all([receipt(U.operador, it, L2, '2'), api(U.catalogo, R.item, 'PATCH', { params: { itemId: it.id }, body: { active: false, reason: 'Carrera de inactivación' } })]);
        const row = await db.inventoryItem.findUnique({ where: { id: it.id } });
        const stock = await mat(it, L2);
        assert.ok(!(mov.status === 201 && inact.status === 200), `ambas operaciones aceptadas en la carrera ${i}`);
        assert.ok(row.active || stock === '0', `artículo inactivo con existencia en la carrera ${i}`);
        races.push(`${mov.status}/${inact.status}`);
      }
      const lt = new Client({ connectionString: url }); await lt.connect();
      try {
        await receipt(U.operador, I3, L2, '1');
        await lt.query('BEGIN');
        await lt.query(`SELECT 1 FROM "WarehouseLocation" WHERE "id" = $1 FOR UPDATE`, [L3.id]);
        const pending = transfer(U.operador, I3, L2, L3, '1');
        await new Promise(r => setTimeout(r, 400));
        await lt.query(`UPDATE "WarehouseLocation" SET "active" = false, "updatedAt" = now() WHERE "id" = $1`, [L3.id]);
        await lt.query('COMMIT');
        const res = await pending;
        assert.equal(res.status, 409, res.text);
      } finally { await lt.end(); }
      await db.warehouseLocation.update({ where: { id: L3.id }, data: { active: true } });
      ok('V28', `carreras movimiento vs inactivación (8 artículos: ${races.join(', ')}) y transferencia vs inactivación de ubicación: nunca quedan ambas aceptadas ni material en catálogo inactivo`);
      const emptyLoc = await api(U.catalogo, R.locations, 'POST', { body: { warehouseId: wh.id, code: 'V2-VACIA', name: 'Ubicación vacía QA', reason: 'Alta de ubicación de prueba' } });
      assert.equal(emptyLoc.status, 201, emptyLoc.text);
      assert.equal((await api(U.catalogo, R.locations, 'POST', { body: { warehouseId: wh.id, code: 'v2-vacia', name: 'Duplicada', reason: 'Alta duplicada de prueba' } })).status, 409);
      const off = await api(U.catalogo, R.location, 'PATCH', { params: { locationId: emptyLoc.json.location.id }, body: { active: false, reason: 'Ubicación sin uso' } });
      assert.equal(off.status, 200); assert.equal(off.json.location.active, false);
      assert.equal((await receipt(U.operador, I1, emptyLoc.json.location, '1')).status, 400, 'no se registran entradas en una ubicación inactiva');
      assert.equal((await api(U.catalogo, R.location, 'DELETE', { params: { locationId: L1.id } })).status, 405);
      const list = await api(U.catalogo, R.locations, 'GET', { query: `?warehouseId=${wh.id}&status=inactive` });
      assert.ok(list.json.rows.some(r => r.id === emptyLoc.json.location.id));
      ok('V29', 'ubicaciones: alta, duplicado rechazado, inactivación de ubicación vacía, sin entradas posteriores, sin eliminación y filtro por estado');
    }

    // ======================================================== V30–V31 Consulta habitual de existencias y paginación
    {
      const pageA = await api(U.consulta, R.stock, 'GET', { query: `?q=${encodeURIComponent(marker)}&limit=2` });
      assert.equal(pageA.status, 200, pageA.text);
      const seen = new Set(); let cursor = null; let pages = 0;
      for (;;) {
        const p = await api(U.consulta, R.stock, 'GET', { query: `?q=${encodeURIComponent(marker)}&limit=2${cursor ? `&cursor=${cursor}` : ''}` });
        pages += 1;
        for (const r of p.json.rows) { const k = `${r.itemId}|${r.locationId}`; assert.ok(!seen.has(k)); seen.add(k); assert.equal(r.quantity, await bal({ id: r.itemId }, { id: r.locationId })); }
        if (!p.json.nextCursor) break; cursor = p.json.nextCursor;
      }
      const expected = (await db.$queryRawUnsafe(`SELECT COUNT(*)::int n FROM "InventoryStockBalance" WHERE "itemId" = ANY($1) AND "quantity" <> 0`, ids.items))[0].n;
      assert.equal(seen.size, expected);
      assert.equal((await api(U.consulta, R.stock, 'GET', { query: '?cursor=basura' })).status, 400);
      assert.equal((await api(null, R.stock, 'GET')).status, 401);
      const csv = await api(U.consulta, R.stock, 'GET', { query: `?q=${encodeURIComponent(marker)}&format=csv` });
      assert.equal(csv.text.trim().split('\r\n').length, expected + 1);
      ok('V30', `consulta de existencias paginada: ${pages} páginas, ${expected} saldos sin duplicados ni omisiones, cada uno igual al libro mayor; CSV completo`);
      const inv = await api(U.consulta, R.inventory, 'GET');
      const row = inv.json.inventory.find(x => x.id === I2.id);
      const sum = (await db.$queryRawUnsafe(`SELECT (COALESCE(SUM(CASE WHEN "destinationLocationId" IS NOT NULL THEN "quantity" END),0) - COALESCE(SUM(CASE WHEN "originLocationId" IS NOT NULL THEN "quantity" END),0))::text s FROM "InventoryMovement" WHERE "itemId" = $1`, I2.id))[0].s;
      assert.equal(row.quantity, Number(sum)); assert.equal(inv.json.balances, undefined, 'la consulta habitual no descarga cada saldo');
      assert.ok(Array.isArray(inv.json.locations));
      const full = await api(U.consulta, R.inventory, 'GET', { query: '?include=balances' });
      assert.ok(Array.isArray(full.json.balances));
      ok('V31', 'inventario: totales por artículo desde la existencia materializada = suma del libro mayor; el detalle completo solo bajo petición');
    }

    // ======================================================== V32 Diagnóstico y vinculación de custodias históricas (script)
    {
      const I4 = await mkItem('LINK');
      await receipt(U.operador, I4, L2, '20');
      const t0 = new Date(Date.now() - 3 * 86400000); const t1 = new Date(Date.now() - 2 * 86400000);
      const mv = (folio, q, ref, at) => db.inventoryMovement.create({ data: { folio: `${marker}-${folio}`, itemId: I4.id, type: 'OPERATIONAL_HANDOFF', quantity: q, unit: 'PZ', originLocationId: L2.id, referenceNumber: ref, occurredAt: at, actorId: U.operador } });
      const cu = async (folio, q, ref, at) => { const c = await db.inventoryCustody.create({ data: { folio: `${marker}-${folio}`, itemId: I4.id, quantity: q, unit: 'PZ', custodianAreaId: productionArea.id, status: 'IN_TRANSIT', referenceNumber: ref, enteredAt: at, createdById: U.operador } });
        await db.inventoryCustodyEvent.create({ data: { custodyId: c.id, type: 'CREATED', quantity: q, occurredAt: at, actorId: U.operador } }); return c; };
      const mA = await mv('LKA', 2, `${marker}-LK1`, t0); const cA = await cu('CLA', 2, `${marker}-LK1`, new Date(t0.getTime() + 30000));
      await mv('LKB1', 3, `${marker}-LK2`, t1); await mv('LKB2', 3, `${marker}-LK2`, t1); const cB = await cu('CLB', 3, `${marker}-LK2`, new Date(t1.getTime() + 10000));
      const cC = await cu('CLC', 9, null, new Date(t1.getTime() + 3600000));
      const { spawnSync } = require('node:child_process');
      const out = path.join(require('node:os').tmpdir(), `yf-link-${randomUUID()}.json`);
      const runLink = extra => spawnSync(process.execPath, [...process.execArgv.filter(a => !a.startsWith('--test')), 'scripts/warehouse-custody-link.cjs', '--marcador', `${marker}-LINK`, '--salida', out, ...extra],
        { cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8', timeout: 120000 });
      const movBefore = await db.inventoryMovement.count({ where: { itemId: I4.id } });
      const diag = runLink([]); assert.equal(diag.status, 0, diag.stderr);
      const rep = JSON.parse(readFileSync(out, 'utf8'));
      assert.deepEqual([rep.entrega.inequivocos, rep.entrega.ambiguos, rep.entrega.huerfanos], [1, 1, 1]);
      assert.equal(rep.entrega.detalle.unambiguous[0].custodyId, cA.id); assert.equal(rep.entrega.detalle.unambiguous[0].movementId, mA.id);
      assert.equal(rep.entrega.detalle.ambiguous[0].custodyId, cB.id); assert.equal(rep.entrega.detalle.ambiguous[0].candidates.length, 2);
      assert.equal(rep.entrega.detalle.orphans[0].id ?? rep.entrega.detalle.orphans[0].custodyId, cC.id);
      assert.equal((await db.inventoryCustody.findUnique({ where: { id: cA.id } })).sourceMovementId, null, 'el diagnóstico no modifica nada');
      const app = runLink(['--aplicar']); assert.equal(app.status, 0, app.stderr);
      assert.equal(JSON.parse(readFileSync(out, 'utf8')).aplicado.entrega, 1);
      assert.equal((await db.inventoryCustody.findUnique({ where: { id: cA.id } })).sourceMovementId, mA.id);
      assert.equal((await db.inventoryCustody.findUnique({ where: { id: cB.id } })).sourceMovementId, null, 'el caso ambiguo no se vincula');
      assert.equal((await db.inventoryCustody.findUnique({ where: { id: cC.id } })).sourceMovementId, null, 'el huérfano no se inventa');
      assert.equal(await db.inventoryMovement.count({ where: { itemId: I4.id } }), movBefore, 'no se crean ni modifican movimientos');
      require('node:fs').rmSync(out, { force: true });
      ok('V32', 'vinculación histórica: diagnóstico de solo lectura (1 inequívoco, 1 ambiguo, 1 huérfano); al aplicar solo se vincula el inequívoco; sin movimientos nuevos');
    }
  } finally {
    // ================================================================ limpieza controlada de datos sintéticos
    try {
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SELECT set_config('yellowflex.fixture_cleanup', $1, true)", marker);
        const items = [...ids.items, ...ids.extraItems];
        const counts = await tx.warehouseCount.findMany({ where: { itemId: { in: items } }, select: { id: true } });
        const discs = await tx.warehouseDiscrepancy.findMany({ where: { countId: { in: counts.map(c => c.id) } }, select: { id: true } });
        await tx.warehouseDiscrepancyEvent.deleteMany({ where: { discrepancyId: { in: discs.map(d => d.id) } } });
        await tx.warehouseDiscrepancyRecount.deleteMany({ where: { discrepancyId: { in: discs.map(d => d.id) } } });
        await tx.warehouseDiscrepancy.deleteMany({ where: { id: { in: discs.map(d => d.id) } } });
        await tx.warehouseCount.deleteMany({ where: { itemId: { in: items } } });
        const cus = await tx.inventoryCustody.findMany({ where: { itemId: { in: items } }, select: { id: true } });
        await tx.inventoryCustodyEvent.deleteMany({ where: { custodyId: { in: cus.map(c => c.id) } } });
        await tx.inventoryCustodyOperation.deleteMany({ where: { custodyId: { in: cus.map(c => c.id) } } });
        await tx.inventoryCustody.updateMany({ where: { itemId: { in: items } }, data: { parentCustodyId: null } });
        await tx.inventoryCustody.deleteMany({ where: { itemId: { in: items } } });
        await tx.warehouseReconciliationException.deleteMany({ where: { actorId: { in: ids.users } } });
        await tx.inventoryMovement.deleteMany({ where: { itemId: { in: items } } });
        await tx.warehouseStockOperation.deleteMany({ where: { actorId: { in: ids.users } } });
        await tx.warehouseCatalogAudit.deleteMany({ where: { actorId: { in: ids.users } } });
        await tx.inventoryStockBalance.deleteMany({ where: { itemId: { in: items }, quantity: 0 } });
        await tx.inventoryItem.deleteMany({ where: { id: { in: items } } });
        if (ids.warehouse) { await tx.warehouseLocation.deleteMany({ where: { warehouseId: ids.warehouse } }); await tx.warehouse.delete({ where: { id: ids.warehouse } }); }
        await tx.corporatePermissionAudit.deleteMany({ where: { OR: [{ actorId: { in: ids.users } }, { targetId: { in: ids.users } }] } });
        await tx.warehousePermission.deleteMany({ where: { userId: { in: ids.users } } });
        await tx.corporateModulePermission.deleteMany({ where: { userId: { in: ids.users } } });
        await tx.userRole.deleteMany({ where: { userId: { in: ids.users } } });
        await tx.user.deleteMany({ where: { id: { in: ids.users } } });
      }, { timeout: 120000 });
      const [residue] = await db.$queryRawUnsafe(`SELECT (SELECT COUNT(*) FROM "User" WHERE "name" LIKE $1)::int AS users,
        (SELECT COUNT(*) FROM "InventoryItem" WHERE "code" LIKE $1)::int AS items, (SELECT COUNT(*) FROM "Warehouse" WHERE "name" LIKE $1)::int AS warehouses,
        (SELECT COUNT(*) FROM "InventoryMovement" WHERE "folio" LIKE $1 OR "referenceNumber" LIKE $1)::int AS movements,
        (SELECT COUNT(*) FROM "yf_stock_balance_differences"())::int AS r8`, `${marker}%`);
      assert.deepEqual(residue, { users: 0, items: 0, warehouses: 0, movements: 0, r8: 0 });
      t.diagnostic(`QA YF-003 V2 limpieza: ${JSON.stringify(residue)}`);
      t.diagnostic(`QA YF-003 V2: escenarios=${results.length} ${results.join(',')}`);
      await assertIsolatedIdentity(db);
    } finally { await sql.end(); await db.$disconnect(); }
  }
});
