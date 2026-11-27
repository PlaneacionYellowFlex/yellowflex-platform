/* eslint-disable @typescript-eslint/no-require-imports */
// YF-003 · Warehouse contra PostgreSQL aislado (127.0.0.1:55432/yellowflex_restore_test). Fixtures propios con marcador
// QA-WH-YF003-<uuid> (almacén, ubicaciones, artículo y usuarios) y limpieza completa al final.
// node --require ./tests/helpers/server-only-register.cjs --import tsx --test tests/warehouse-yf003-postgres.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('./helpers/isolated-postgres.cjs');

test('YF-003 Warehouse: aprobación sin atajos, separación de funciones, idempotencia, concurrencia y consistencia', {
  skip: process.env.RUN_WAREHOUSE_YF003_DB_TESTS !== '1',
}, async (t) => {
  const url = configureIsolatedConnection();
  const { PrismaClient, Prisma } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  const marker = `QA-WH-YF003-${randomUUID()}`;
  const ids = { users: [], warehouse: null, item: null };
  let scenarios = 0;
  const ok = name => { scenarios += 1; t.diagnostic(`ESCENARIO OK ${String(scenarios).padStart(2, '0')}: ${name}`); };
  try {
    await assertIsolatedIdentity(db);
    globalThis.prisma = db;
    const [warehouseArea, productionArea] = await Promise.all([
      db.operationalArea.findUnique({ where: { code: 'ALMACEN' } }), db.operationalArea.findUnique({ where: { code: 'PRODUCCION' } })]);
    assert.ok(warehouseArea?.active && productionArea?.active, 'Faltan los catálogos estructurales ALMACEN y PRODUCCION; no se modifican');

    const movements = require('../repositories/warehouse-movements.repository.ts');
    const custody = require('../repositories/warehouse-custody.repository.ts');
    const counts = require('../repositories/warehouse-counts.repository.ts');
    const recounts = require('../repositories/warehouse-recounts.repository.ts');
    const disc = require('../repositories/warehouse-discrepancies.repository.ts');
    const { getWarehouseStockBalance } = require('../repositories/warehouse-stock-lock.ts');
    const { getWarehouseCapabilities } = require('../lib/warehouse/capabilities.ts');

    // ---------------- fixtures
    const mkUser = async (label, roles, grants = [], legacy = null) => {
      const u = await db.user.create({ data: { name: `${marker}-${label}`, email: `${label}.${marker}@example.invalid`.toLowerCase(), passwordMustChange: false,
        roles: { create: roles.map(role => ({ role })) } } });
      ids.users.push(u.id);
      if (grants.length) await db.corporateModulePermission.createMany({ data: grants.map(a => ({ userId: u.id, moduleKey: 'warehouse', actionKey: a, granted: true })) });
      if (legacy) await db.warehousePermission.create({ data: { userId: u.id, ...legacy } });
      return u.id;
    };
    const OPERATE = ['view', 'operate']; const APPROVE = ['view', 'approve'];
    const operator = await mkUser('operador', ['EMPLEADO'], OPERATE, { canViewInventory: true, canRegisterMovement: true });
    const counter = await mkUser('contador', ['EMPLEADO'], OPERATE, { canViewInventory: true, canRegisterMovement: true, canApproveWarehouseAdjustments: true });
    const recounter = await mkUser('recontador', ['EMPLEADO'], OPERATE, { canViewInventory: true, canManageWarehouse: true });
    const investigator = await mkUser('investigador', ['EMPLEADO'], [...OPERATE, 'approve'], { canViewInventory: true, canManageWarehouse: true, canApproveWarehouseAdjustments: true });
    const approver = await mkUser('aprobador', ['EMPLEADO'], APPROVE, { canViewInventory: true, canApproveWarehouseAdjustments: true });
    const approver2 = await mkUser('aprobador2', ['EMPLEADO'], APPROVE, { canViewInventory: true, canApproveWarehouseAdjustments: true });
    const admin = await mkUser('admin', ['ADMIN']);
    const director = await mkUser('direccion', ['DIRECCION']);
    const adminLegacyOnly = await mkUser('admin-legado', ['ADMIN'], [], { canViewInventory: true, canApproveWarehouseAdjustments: true });
    await db.corporateModulePermission.create({ data: { userId: counter, moduleKey: 'warehouse', actionKey: 'approve', granted: true } });

    const wh = await db.warehouse.create({ data: { code: marker.slice(0, 40), name: `${marker} almacén` } }); ids.warehouse = wh.id;
    const [L1, L2] = await Promise.all(['A-1-1', 'A-1-18'].map(code => db.warehouseLocation.create({ data: { warehouseId: wh.id, code, name: `${marker} ${code}` } })));
    const item = await db.inventoryItem.create({ data: { code: marker, description: `${marker} artículo ficticio`, baseUnit: 'PZ' } }); ids.item = item.id;
    const folio = p => `${p}-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    await movements.createWarehouseMovement({ folio: folio('QA-IM'), itemId: item.id, type: 'INITIAL_BALANCE', quantity: 10, unit: 'PZ',
      destinationLocationId: L1.id, notes: marker, occurredAt: new Date(), actorId: operator });
    const bal = async loc => (await getWarehouseStockBalance(db, item.id, loc)).toNumber();
    const movementCount = () => db.inventoryMovement.count({ where: { itemId: item.id } });

    // ---------------- 1. capacidades efectivas desde PostgreSQL
    {
      const c = id => getWarehouseCapabilities(id, db);
      assert.deepEqual(await c(admin), { view: true, operate: false, investigate: false, approve: false, audit: true, production: false, productionView: true, catalog: false });
      assert.ok(Object.values(await c(director)).every(v => v === false));
      assert.equal((await c(adminLegacyOnly)).approve, false, 'ADMIN con permiso operativo pero sin C-PANEL Aprobar no aprueba');
      assert.equal((await c(approver)).approve, true);
      assert.equal((await c(operator)).operate, true);
      assert.equal((await c(operator)).approve, false);
      ok('capacidades: ADMIN solo consulta, DIRECCIÓN sin nada por rol, cada capacidad exige concesión explícita');
    }

    // ---------------- 2-5. entradas externas idempotentes
    const receipt = (key, quantity, actorId = operator) => movements.createExternalReceiptOnce({
      folio: folio('QA-IM'), itemId: item.id, type: 'EXTERNAL_RECEIPT', quantity, unit: 'PZ', originLocationId: null, destinationLocationId: L1.id,
      referenceType: 'QA', referenceNumber: marker, notes: null, occurredAt: new Date(), actorId,
    }, { idempotencyKey: key, payload: { itemId: item.id, destinationLocationId: L1.id, quantity: Number(quantity).toFixed(3), referenceNumber: marker } },
    m => ({ movement: { folio: m.folio, quantity: m.quantity.toNumber() } }));
    {
      const before = await movementCount(); const key = randomUUID();
      const a = await receipt(key, 5); const b = await receipt(key, 5);
      assert.equal(a.replayed, false); assert.equal(b.replayed, true); assert.equal(a.response.movement.folio, b.response.movement.folio);
      assert.equal(await movementCount(), before + 1); assert.equal(await bal(L1.id), 15);
      ok('entrada externa repetida (doble clic o reintento) crea un solo movimiento y devuelve el original');
      await assert.rejects(receipt(key, 6), e => e instanceof movements.WarehouseStockOperationConflictError);
      assert.equal(await movementCount(), before + 1);
      ok('misma clave con otra cantidad se rechaza sin crear movimiento');
      const k2 = randomUUID();
      const results = await Promise.all(Array.from({ length: 8 }, () => receipt(k2, 2)));
      assert.equal(new Set(results.map(r => r.response.movement.folio)).size, 1);
      assert.equal(results.filter(r => !r.replayed).length, 1);
      assert.equal(await movementCount(), before + 2); assert.equal(await bal(L1.id), 17);
      ok('ocho solicitudes simultáneas con la misma clave crean exactamente una entrada');
      const other = randomUUID();
      const r2 = await receipt(other, 2, counter);
      assert.equal(r2.replayed, false);
      assert.equal((await receipt(other, 2, operator)).replayed, false, 'la clave es por usuario');
      assert.equal(await bal(L1.id), 21);
      ok('claves distintas o usuarios distintos registran entradas independientes');
    }

    // ---------------- 6-8. entregas a Producción idempotentes y sin sobregiro
    const handoff = (key, quantity, from = L1.id) => custody.createOperationalHandoffOnce({
      movementFolio: folio('QA-IM'), custodyFolio: folio('QA-CUS'), itemId: item.id, quantity: new Prisma.Decimal(quantity), unit: 'PZ',
      originLocationId: from, warehouseAreaId: warehouseArea.id, productionAreaId: productionArea.id, referenceType: 'QA', referenceNumber: marker,
      reason: 'Entrega QA', notes: null, occurredAt: new Date(), actorId: operator,
    }, { idempotencyKey: key, payload: { itemId: item.id, originLocationId: from, quantity: Number(quantity).toFixed(3) } },
    r => ({ movement: { folio: r.movement.folio }, custody: { folio: r.custody.folio }, availableAfter: r.availableBefore - Number(quantity) }));
    {
      const custodies = () => db.inventoryCustody.count({ where: { itemId: item.id } });
      const key = randomUUID();
      const res = await Promise.all(Array.from({ length: 6 }, () => handoff(key, 4)));
      assert.equal(new Set(res.map(r => r.response.custody.folio)).size, 1);
      assert.equal(await custodies(), 1); assert.equal(await bal(L1.id), 17);
      ok('seis entregas simultáneas con la misma clave crean un movimiento y una custodia');
      await assert.rejects(handoff(key, 3), e => e instanceof movements.WarehouseStockOperationConflictError);
      ok('entrega con clave reutilizada y contenido distinto se rechaza');
    }
    {
      // Traslado A-1-1 → A-1-18 (como el antecedente) y tres entregas simultáneas de 2 piezas con claves distintas: solo una procede.
      const { payloadHash } = require('../lib/warehouse-idempotency.ts');
      const body = { itemId: item.id, originLocationId: L1.id, destinationLocationId: L2.id, quantity: '3.000', referenceType: null, referenceNumber: null, notes: `${marker} traslado de prueba` };
      await movements.createInternalTransfer({ folio: folio('QA-IM'), itemId: item.id, quantity: new Prisma.Decimal(3), unit: 'PZ', originLocationId: L1.id, originLocationCode: L1.code,
        destinationLocationId: L2.id, referenceType: null, referenceNumber: null, notes: body.notes, occurredAt: new Date(), actorId: operator,
        operationKey: `INTERNAL_TRANSFER:${operator}:${randomUUID()}`, operationPayloadHash: payloadHash({ kind: 'INTERNAL_TRANSFER', actorId: operator, payload: body }) });
      assert.equal(await bal(L2.id), 3); assert.equal(await bal(L1.id), 14);
      const outcomes = await Promise.allSettled([randomUUID(), randomUUID(), randomUUID()].map(k => handoff(k, 2, L2.id)));
      assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
      assert.ok(outcomes.filter(o => o.status === 'rejected').every(o => o.reason instanceof custody.InsufficientWarehouseStockError));
      assert.equal(await bal(L2.id), 1);
      const ops = await db.warehouseStockOperation.count({ where: { kind: 'OPERATIONAL_HANDOFF', actorId: operator } });
      assert.equal(ops, 2, 'las entregas rechazadas no dejan registro de operación');
      ok('entregas simultáneas con claves distintas no sobregiran la existencia; las rechazadas se revierten completas');
    }

    // ---------------- 9-10. conteos concurrentes
    let countId;
    {
      const launch = () => counts.createWarehouseCount({ folio: folio('QA-CNT'), itemId: item.id, locationId: L1.id, type: 'CYCLE', actorId: operator });
      const r = await Promise.allSettled([launch(), launch(), launch()]);
      assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
      assert.equal(await db.warehouseCount.count({ where: { itemId: item.id, status: 'OPEN' } }), 1);
      countId = r.find(x => x.status === 'fulfilled').value.id;
      ok('tres lanzamientos simultáneos del mismo conteo abren uno solo');
      const done = await Promise.allSettled([11, 11].map(q => counts.completeWarehouseCount({ id: countId, countedQuantity: q, actorId: counter })));
      assert.equal(done.filter(x => x.status === 'fulfilled').length, 1);
      assert.equal(await db.warehouseDiscrepancy.count({ where: { countId } }), 1);
      ok('doble cierre simultáneo del conteo registra un solo resultado y un solo expediente de diferencia');
    }

    // ---------------- 11-16. aprobación de ajustes
    const discrepancy = await db.warehouseDiscrepancy.findUniqueOrThrow({ where: { countId } });
    assert.equal(Number((await db.warehouseCount.findUniqueOrThrow({ where: { id: countId } })).difference), -3);
    await disc.updateDiscrepancy(discrepancy.id, { classification: 'REAL', cause: 'Piezas ficticias de prueba consumidas', notes: marker, resolution: 'Ajustar con autorización', close: false, actorId: investigator });
    const rc = await recounts.requestRecount(discrepancy.id, 'Confirmar diferencia física', investigator, folio('QA-REC'));
    await recounts.completeRecount(rc.id, 11, 'Reconteo QA', recounter);
    const approve = actor => disc.approveDiscrepancyAdjustment(discrepancy.id, actor, folio('QA-AJ'));
    {
      for (const [who, label] of [[admin, 'ADMIN sin concesiones'], [director, 'DIRECCIÓN sin concesiones'], [adminLegacyOnly, 'ADMIN solo con permiso operativo']]) {
        await assert.rejects(approve(who), /autorización expresa/, label);
      }
      ok('ADMIN y DIRECCIÓN no aprueban ajustes por su rol');
      await assert.rejects(approve(counter), /distinto del contador/);
      await assert.rejects(approve(investigator), /investigó/);
      ok('separación de funciones: quien contó o investigó no aprueba aunque tenga autorización');
      assert.equal(await db.inventoryMovement.count({ where: { itemId: item.id, referenceType: 'WAREHOUSE_DISCREPANCY' } }), 0);
      await db.corporateModulePermission.update({ where: { userId_moduleKey_actionKey: { userId: approver2, moduleKey: 'warehouse', actionKey: 'approve' } }, data: { granted: false } });
      await assert.rejects(approve(approver2), /autorización expresa/);
      ok('revocar la concesión surte efecto inmediato dentro de la transacción de aprobación');
      await db.corporateModulePermission.update({ where: { userId_moduleKey_actionKey: { userId: approver2, moduleKey: 'warehouse', actionKey: 'approve' } }, data: { granted: true } });
      const before = await bal(L1.id);
      const settled = await Promise.allSettled([approve(approver), approve(approver2)]);
      assert.equal(settled.filter(s => s.status === 'fulfilled').length, 1);
      const adj = await db.inventoryMovement.findMany({ where: { itemId: item.id, referenceType: 'WAREHOUSE_DISCREPANCY' } });
      assert.equal(adj.length, 1); assert.equal(adj[0].type, 'ADJUSTMENT_OUT'); assert.equal(Number(adj[0].quantity), 3);
      assert.equal(await bal(L1.id), before - 3);
      const closed = await db.warehouseDiscrepancy.findUniqueOrThrow({ where: { id: discrepancy.id } });
      assert.equal(closed.status, 'CLOSED'); assert.ok([approver, approver2].includes(closed.approvedById));
      ok('dos aprobaciones simultáneas autorizadas producen exactamente un ajuste trazable');
      await assert.rejects(approve(approver), /ya fue aprobada|cerrada/);
      ok('una aprobación repetida se rechaza sin segundo movimiento');
    }

    // ---------------- 17. consistencia de existencias y trazabilidad
    {
      const all = await db.inventoryMovement.findMany({ where: { itemId: item.id } });
      const byLoc = new Map();
      for (const m of all) {
        if (m.destinationLocationId) byLoc.set(m.destinationLocationId, (byLoc.get(m.destinationLocationId) ?? 0) + Number(m.quantity));
        if (m.originLocationId) byLoc.set(m.originLocationId, (byLoc.get(m.originLocationId) ?? 0) - Number(m.quantity));
      }
      for (const [loc, q] of byLoc) { assert.ok(q >= 0, `existencia negativa en ${loc}`); assert.equal(q, await bal(loc)); }
      assert.equal(await bal(L1.id), 11); assert.equal(await bal(L2.id), 1);
      assert.ok(all.every(m => m.actorId && m.folio && m.occurredAt), 'todo movimiento conserva actor, folio y fecha');
      ok('existencias = suma de movimientos por ubicación, sin negativos y con trazabilidad completa');
    }
  } finally {
    // ---------------- limpieza completa de fixtures
    try {
      // YF-003 V2: libro mayor e historiales append-only; toda la limpieza ocurre en una transacción que declara el marcador sintético.
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SELECT set_config('yellowflex.fixture_cleanup', $1, true)", marker);
        if (ids.item) {
          const discs = await tx.warehouseDiscrepancy.findMany({ where: { count: { itemId: ids.item } }, select: { id: true } });
          await tx.warehouseDiscrepancyEvent.deleteMany({ where: { discrepancyId: { in: discs.map(d => d.id) } } });
          await tx.warehouseDiscrepancyRecount.deleteMany({ where: { discrepancyId: { in: discs.map(d => d.id) } } });
          await tx.warehouseDiscrepancy.deleteMany({ where: { id: { in: discs.map(d => d.id) } } });
          await tx.warehouseCount.deleteMany({ where: { itemId: ids.item } });
          const cus = await tx.inventoryCustody.findMany({ where: { itemId: ids.item }, select: { id: true } });
          await tx.inventoryCustodyEvent.deleteMany({ where: { custodyId: { in: cus.map(c => c.id) } } });
          await tx.inventoryCustodyOperation.deleteMany({ where: { custodyId: { in: cus.map(c => c.id) } } });
          await tx.inventoryCustody.deleteMany({ where: { itemId: ids.item } });
          await tx.inventoryMovement.deleteMany({ where: { itemId: ids.item } });
          await tx.inventoryItem.delete({ where: { id: ids.item } });
        }
        await tx.warehouseStockOperation.deleteMany({ where: { actorId: { in: ids.users } } });
        if (ids.warehouse) { await tx.warehouseLocation.deleteMany({ where: { warehouseId: ids.warehouse } }); await tx.warehouse.delete({ where: { id: ids.warehouse } }); }
        await tx.warehousePermission.deleteMany({ where: { userId: { in: ids.users } } });
        await tx.corporateModulePermission.deleteMany({ where: { userId: { in: ids.users } } });
        await tx.userRole.deleteMany({ where: { userId: { in: ids.users } } });
        await tx.user.deleteMany({ where: { id: { in: ids.users } } });
      }, { timeout: 120000 });
      const residue = {
        users: await db.user.count({ where: { name: { startsWith: marker } } }),
        items: await db.inventoryItem.count({ where: { code: marker } }),
        movements: await db.inventoryMovement.count({ where: { OR: [{ notes: { contains: marker } }, { referenceNumber: marker }] } }),
        warehouses: await db.warehouse.count({ where: { name: { startsWith: marker } } }),
      };
      assert.deepEqual(residue, { users: 0, items: 0, movements: 0, warehouses: 0 });
      t.diagnostic(`QA YF-003 limpieza: ${JSON.stringify(residue)}`);
      t.diagnostic(`QA YF-003: escenarios=${scenarios}`);
      await assertIsolatedIdentity(db);
    } finally { await db.$disconnect(); }
  }
});
