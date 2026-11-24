/* eslint-disable @typescript-eslint/no-require-imports */
// YF-002 Bloque A — motor de prenómina contra PostgreSQL real aislado (127.0.0.1:55432/yellowflex_restore_test).
// Ejecutar con: node --require ./tests/helpers/server-only-register.cjs --import tsx --test tests/food-payroll-batch-postgres.test.cjs
// Requiere RUN_FOOD_PAYROLL_DB_TESTS=1. Crea fixtures QA-FIXTURE-* propios y los elimina al terminar.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomInt } = require('node:crypto');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('./helpers/isolated-postgres.cjs');

const passed = [];
function scenario(name) { passed.push(name); console.log(`ESCENARIO OK ${String(passed.length).padStart(2, '0')}: ${name}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function gate() { let open; const p = new Promise(r => { open = r; }); return { wait: () => p, open }; }

/** Cliente con puntos de espera controlados por la prueba (solo intercepta los métodos indicados). */
function gatedClient(db, hooks) {
  const wrapTx = tx => new Proxy(tx, { get(t, model) {
    const target = t[model];
    const h = hooks[model];
    if (!h || !target || typeof target !== 'object') return target;
    return new Proxy(target, { get(m, op) {
      const fn = m[op];
      if (typeof fn !== 'function' || !h[op]) return fn;
      return async (...args) => { await h[op](args); return fn.apply(m, args); };
    } });
  } });
  return new Proxy(db, { get(t, k) {
    if (k === '$transaction') return (cb, opts) => t.$transaction(tx => cb(wrapTx(tx)), opts);
    return t[k];
  } });
}

test('prenómina Bloque A: preview, generación idempotente, concurrencia, inmutabilidad y cancelación', {
  skip: process.env.RUN_FOOD_PAYROLL_DB_TESTS !== '1', timeout: 180000,
}, async () => {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  const run = randomUUID().slice(0, 8);
  const marker = `QA-FIXTURE-PAYROLL-${run}`;
  const ref = suffix => `QA-FIXTURE-${run}-${suffix}`.slice(0, 40);
  const qkey = () => `qa-fixture-${randomUUID()}`;
  const userIds = []; const employeeIds = []; const weekIds = [];
  const prevSecret = process.env.FOOD_PAYROLL_PREVIEW_SECRET;
  // Gate de cancelación compartido por el cliente global (lib/db.ts lo toma de globalThis.prisma).
  let cancelGate = null;
  const globalDb = gatedClient(db, { foodOrderCancellation: { create: async () => { if (cancelGate) await cancelGate(); } } });
  try {
    await assertIsolatedIdentity(db);
    process.env.FOOD_PAYROLL_PREVIEW_SECRET = `qa-fixture-secret-${randomUUID()}-${randomUUID()}`;
    globalThis.prisma = globalDb;
    const svc = require('../lib/food-services/payroll-batch-service.ts');
    const contract = require('../lib/food-services/payroll-batch-contract.ts');
    const { cancelFoodOrder } = require('../lib/food-services/order-cancellation.ts');
    const deps = { db };

    // ---------------- fixtures
    const mkUser = async (role, actions) => {
      const u = await db.user.create({ data: { name: `${marker}-${role}`, passwordMustChange: false, roles: { create: { role } } } });
      userIds.push(u.id);
      if (actions.length) await db.corporateModulePermission.createMany({ data: actions.map(actionKey => ({ userId: u.id, moduleKey: 'food-services', actionKey, granted: true })) });
      return { id: u.id, name: u.name, email: null, roles: [role], employee: null };
    };
    const rh = await mkUser('RH', ['view', 'manage', 'create-payroll-batch', 'cancel-food-order']);
    const rh2 = await mkUser('RH', ['view', 'manage', 'create-payroll-batch']);
    const rhNoGrant = await mkUser('RH', ['view', 'manage']);
    const admin = await mkUser('ADMIN', []);
    const dept = await db.department.findFirstOrThrow();
    const shift = await db.workShift.findFirstOrThrow({ where: { active: true } });
    const base = Date.UTC(2198, 0, 6) + randomInt(0, 2000) * 7 * 86400000;
    const weeks = [];
    for (let w = 0; w < 3; w++) {
      const weekStart = new Date(base + w * 7 * 86400000);
      const week = await db.menuWeek.create({ data: { weekStart, status: 'PUBLISHED' } }); weekIds.push(week.id);
      const items = [];
      for (let d = 0; d < 5; d++) {
        const day = await db.menuDay.create({ data: { menuWeekId: week.id, serviceDate: new Date(weekStart.getTime() + d * 86400000) } });
        items.push(await db.menuItem.create({ data: { menuDayId: day.id, name: `${marker} W${w}D${d}`, serviceType: 'BREAKFAST', price: '99.00' } }));
      }
      weeks.push({ week, items });
    }
    let n = 0;
    const mkEmployee = async (status = 'ACTIVE') => {
      const e = await db.employee.create({ data: { employeeNumber: `${marker}-E${n++}`, fullName: `${marker} Colaborador ${n}`, departmentId: dept.id,
        workShiftId: shift.id, pinHash: 'fictional-unusable', pinMustChange: false, status } });
      employeeIds.push(e.id); return e;
    };
    const mkOrder = async (w, { itemCount = 2, price = '35.50', status = 'CONFIRMED', payrollStatus = 'PENDING', employee, total } = {}) => {
      const e = employee ?? await mkEmployee();
      const unit = Number(price); const totalAmount = total ?? (unit * itemCount).toFixed(2);
      return db.foodOrder.create({ data: { employeeId: e.id, menuWeekId: weeks[w].week.id, itemCount, unitPrice: price, totalAmount, status, payrollStatus,
        reservations: { create: weeks[w].items.slice(0, itemCount).map(i => ({ employeeId: e.id, menuItemId: i.id, status: status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE' })) } } });
    };
    const preview = (actor, orderIds, reference) => svc.previewFoodPayrollBatch(actor, { payrollReference: reference, orderIds }, deps);
    const create = (actor, p, orderIds, key, extra = {}) => svc.createFoodPayrollBatch(actor,
      { payrollReference: p.payrollReference, orderIds, previewToken: p.previewToken, ...extra }, key, deps);
    const code = c => err => { assert.equal(err.code, c, `esperado ${c}, recibido ${err.code}: ${err.message}`); return true; };

    // ---------------- autorización C-PANEL: sin acceso implícito para ADMIN
    const o1 = await mkOrder(0); const o2 = await mkOrder(1, { itemCount: 3, price: '42.25' }); const o3 = await mkOrder(2, { itemCount: 1, price: '18.00' });
    await assert.rejects(preview(admin, [o1.id], ref('adm')), /Acceso restringido/);
    await assert.rejects(preview(rhNoGrant, [o1.id], ref('nog')), /Acceso restringido/);

    scenario('autorización C-PANEL: sin acceso implícito para ADMIN');
    // ---------------- selección vacía y repetida
    await assert.rejects(preview(rh, [], ref('empty')), code('INVALID_REQUEST'));
    await assert.rejects(svc.createFoodPayrollBatch(rh, { payrollReference: ref('e'), orderIds: [], previewToken: 'x'.repeat(30) }, qkey(), deps), code('INVALID_REQUEST'));
    await assert.rejects(preview(rh, [o1.id, o1.id], ref('dup')), code('DUPLICATE_ORDER'));

    scenario('selección vacía y repetida');
    // ---------------- generación normal con pedidos de tres semanas
    const refA = ref('A');
    const pA = await preview(rh, [o1.id, o2.id, o3.id], refA);
    assert.equal(pA.eligible.length, 3); assert.equal(pA.excluded.length, 0); assert.equal(pA.serviceWeeks.length, 3);
    assert.equal(pA.totals.eligible.amount, (71 + 126.75 + 18).toFixed(2)); assert.equal(pA.totals.eligible.services, 6);
    assert.ok(pA.previewToken && /^[0-9a-f]{64}$/.test(pA.previewDigest) && pA.actor.id === rh.id && Date.parse(pA.expiresAt) > Date.now());
    const before = await db.foodOrder.findMany({ where: { id: { in: [o1.id, o2.id, o3.id] } }, orderBy: { id: 'asc' } });
    const keyA = qkey();
    const rA = await create(rh, pA, [o3.id, o1.id, o2.id], keyA);
    assert.equal(rA.status, 201); assert.equal(rA.replayed, false);
    assert.deepEqual(rA.body.serviceWeeks.length, 3); assert.equal(rA.body.orderCount, 3); assert.equal(rA.body.committedAmount, '215.75');
    const batchA = await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: rA.body.batchId }, include: { items: true, services: true, assignments: true } });
    assert.equal(batchA.status, 'GENERATED'); assert.equal(batchA.items.length, 3); assert.equal(batchA.services.length, 6); assert.equal(batchA.assignments.length, 3);
    assert.equal(new Set(batchA.items.map(i => i.serviceWeekStart.toISOString())).size, 3, 'cada detalle conserva su semana');
    assert.equal(batchA.committedAmount.toString(), '215.75'); assert.equal(batchA.payrollReference, refA);
    assert.deepEqual(await db.foodOrder.findMany({ where: { id: { in: [o1.id, o2.id, o3.id] } }, orderBy: { id: 'asc' } }), before, 'generar no cambia FoodOrder');
    assert.equal((await db.foodPayrollAuditEvent.count({ where: { batchId: batchA.id, eventType: 'BATCH_CREATED' } })), 1);

    scenario('generación normal con pedidos de tres semanas');
    // ---------------- misma clave: replay; misma clave con payload distinto: 409
    const replay = await create(rh, pA, [o1.id, o2.id, o3.id], keyA);
    assert.equal(replay.status, 200); assert.equal(replay.replayed, true); assert.deepEqual(replay.body, rA.body);
    await assert.rejects(create(rh, pA, [o1.id, o2.id], keyA), code('IDEMPOTENCY_KEY_REUSED'));
    await assert.rejects(create(rh2, pA, [o1.id, o2.id, o3.id], keyA), code('IDEMPOTENCY_KEY_REUSED'));
    assert.equal(await db.foodPayrollBatch.count({ where: { idempotencyKey: keyA } }), 1);

    scenario('misma clave: replay; misma clave con payload distinto: 409');
    // ---------------- reintento válido con token expirado: replay antes de rechazar la expiración
    const payloadA = contract.verifyPreviewToken(pA.previewToken);
    const rawPayload = { ...payloadA }; delete rawPayload.expired;
    const expiredToken = contract.signPreviewToken({ ...rawPayload, exp: Date.now() - 1000 });
    const late = await svc.createFoodPayrollBatch(rh, { payrollReference: refA, orderIds: [o1.id, o2.id, o3.id], previewToken: expiredToken }, keyA, deps);
    assert.equal(late.status, 200); assert.equal(late.replayed, true);
    const o4 = await mkOrder(0);
    const p4 = await preview(rh, [o4.id], ref('exp'));
    const raw4 = { ...contract.verifyPreviewToken(p4.previewToken) }; delete raw4.expired;
    await assert.rejects(svc.createFoodPayrollBatch(rh, { payrollReference: p4.payrollReference, orderIds: [o4.id], previewToken: contract.signPreviewToken({ ...raw4, exp: Date.now() - 1 }) }, qkey(), deps), code('PREVIEW_EXPIRED'));
    await assert.rejects(svc.createFoodPayrollBatch(rh, { payrollReference: p4.payrollReference, orderIds: [o4.id], previewToken: p4.previewToken.slice(0, -2) + 'xx' }, qkey(), deps), code('PREVIEW_INVALID'));
    await assert.rejects(create(rh2, p4, [o4.id], qkey()), code('PREVIEW_ACTOR_MISMATCH'));

    scenario('reintento válido con token expirado: replay antes de rechazar la expiración');
    // ---------------- prevención de cargos duplicados: pedido ya asignado
    const pDup = await preview(rh, [o1.id, o4.id], ref('dupA'));
    assert.deepEqual(pDup.excluded.map(x => [x.orderId, x.reasons]), [[o1.id, ['ACTIVE_ASSIGNMENT_EXISTS']]]);
    await assert.rejects(create(rh, { ...p4, payrollReference: ref('exp') }, [o1.id], qkey()), code('PREVIEW_MISMATCH'));
    await assert.rejects(db.$transaction(async tx => {
      const b = await tx.foodPayrollBatch.create({ data: { id: randomUUID(), idempotencyKey: qkey(), idempotencyRequestHash: 'a'.repeat(64), contractVersion: 1, payrollReference: ref('raw'), previewDigest: 'b'.repeat(64), createdById: rh.id } });
      const e = await tx.employee.findUniqueOrThrow({ where: { id: o1.employeeId } });
      const item = await tx.foodPayrollBatchItem.create({ data: { id: randomUUID(), batchId: b.id, orderId: o1.id, employeeId: o1.employeeId, employeeNumber: e.employeeNumber, employeeName: e.fullName, employeeStatusSnapshot: 'ACTIVE',
        menuWeekId: o1.menuWeekId, serviceWeekStart: weeks[0].week.weekStart, orderStatusSnapshot: 'CONFIRMED', payrollStatusSnapshot: 'PENDING', confirmedAtSnapshot: o1.confirmedAt, orderCreatedAtSnapshot: o1.createdAt,
        itemCount: o1.itemCount, historicalUnitPrice: o1.unitPrice, committedAmount: o1.totalAmount, orderFingerprint: 'c'.repeat(64) } });
      await tx.foodPayrollAssignment.create({ data: { orderId: o1.id, batchId: b.id, batchItemId: item.id } });
    }), err => /unique|one_active_per_order|23505|P2002/i.test(`${err.code} ${err.message} ${JSON.stringify(err.meta ?? '')}`));
    assert.equal(await db.foodPayrollAssignment.count({ where: { orderId: o1.id, status: 'ACTIVE' } }), 1, 'el índice parcial impide un segundo cargo');

    scenario('prevención de cargos duplicados: pedido ya asignado');
    // ---------------- pedidos no elegibles y excolaboradores
    const unverified = await mkOrder(0, { payrollStatus: 'UNVERIFIED' });
    const cancelled = await mkOrder(1, { status: 'CANCELLED' });
    const mismatch = await mkOrder(2, { total: '1.00' });
    const formerEmployee = await mkEmployee('INACTIVE');
    const former = await mkOrder(1, { employee: formerEmployee });
    const pX = await preview(rh, [unverified.id, cancelled.id, mismatch.id, former.id, o4.id, 'no-existe-' + run], ref('X'));
    const reasons = Object.fromEntries(pX.excluded.map(x => [x.orderId, x.reasons]));
    assert.ok(reasons[unverified.id].includes('ORDER_UNVERIFIED'), 'UNVERIFIED nunca se incluye automáticamente');
    assert.ok(reasons[cancelled.id].includes('ORDER_CANCELLED'));
    assert.ok(reasons[mismatch.id].includes('TOTAL_AMOUNT_MISMATCH'));
    assert.deepEqual(reasons['no-existe-' + run], ['ORDER_NOT_FOUND']);
    assert.deepEqual(pX.requiresReview.map(x => x.orderId), [former.id], 'excolaborador: revisión expresa, no exclusión automática');
    assert.deepEqual(pX.eligible.map(x => x.orderId), [o4.id]);
    await assert.rejects(create(rh, pX, [unverified.id, o4.id], qkey()), code('PREVIEW_MISMATCH'));
    await assert.rejects(create(rh, pX, [former.id, o4.id], qkey()), code('INACTIVE_EMPLOYEE_REVIEW_REQUIRED'));
    const rX = await create(rh, pX, [former.id, o4.id], qkey(), { reviewedInactiveOrderIds: [former.id] });
    assert.equal(rX.status, 201);
    const formerItem = await db.foodPayrollBatchItem.findFirstOrThrow({ where: { batchId: rX.body.batchId, orderId: former.id } });
    assert.equal(formerItem.inactiveEmployeeReviewed, true); assert.equal(formerItem.employeeStatusSnapshot, 'INACTIVE');

    scenario('pedidos no elegibles y excolaboradores');
    // ---------------- vista previa desactualizada
    const o5 = await mkOrder(0); const p5 = await preview(rh, [o5.id], ref('stale'));
    await db.employee.update({ where: { id: o5.employeeId }, data: { fullName: `${marker} nombre cambiado` } });
    await assert.rejects(create(rh, p5, [o5.id], qkey()), code('PREVIEW_STALE'));
    assert.equal(await db.foodPayrollAssignment.count({ where: { orderId: o5.id } }), 0);

    scenario('vista previa desactualizada');
    // ---------------- dos lotes concurrentes sobre el mismo pedido
    const o6 = await mkOrder(1);
    const p6a = await preview(rh, [o6.id], ref('c1')); const p6b = await preview(rh2, [o6.id], ref('c2'));
    const race = await Promise.allSettled([create(rh, p6a, [o6.id], qkey()), create(rh2, p6b, [o6.id], qkey())]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1, JSON.stringify(race.map(r => r.reason?.code)));
    const lost = race.find(r => r.status === 'rejected');
    assert.equal(lost.reason.code, 'ACTIVE_ASSIGNMENT_EXISTS');
    assert.equal(await db.foodPayrollAssignment.count({ where: { orderId: o6.id, status: 'ACTIVE' } }), 1);

    scenario('dos lotes concurrentes sobre el mismo pedido');
    // ---------------- misma clave en paralelo: un 201 y un replay 200
    const o7 = await mkOrder(2); const p7 = await preview(rh, [o7.id], ref('k')); const k7 = qkey();
    const same = await Promise.allSettled([create(rh, p7, [o7.id], k7), create(rh, p7, [o7.id], k7)]);
    assert.deepEqual(same.map(r => r.status), ['fulfilled', 'fulfilled'], JSON.stringify(same.map(r => r.reason?.code)));
    assert.deepEqual(same.map(r => r.value.status).sort(), [200, 201]);
    assert.equal(await db.foodPayrollBatch.count({ where: { idempotencyKey: k7 } }), 1);

    scenario('misma clave en paralelo: un 201 y un replay 200');
    // ---------------- reversión completa ante error
    const o8 = await mkOrder(0); const p8 = await preview(rh, [o8.id], ref('rb')); const k8 = qkey();
    const failing = gatedClient(db, { foodPayrollAssignment: { createMany: async () => { throw new Error('QA fallo simulado tras snapshots'); } } });
    await assert.rejects(svc.createFoodPayrollBatch(rh, { payrollReference: p8.payrollReference, orderIds: [o8.id], previewToken: p8.previewToken }, k8, { db: failing }), /fallo simulado/);
    assert.equal(await db.foodPayrollBatch.count({ where: { idempotencyKey: k8 } }), 0);
    assert.equal(await db.foodPayrollBatchItem.count({ where: { orderId: o8.id } }), 0);
    assert.equal(await db.foodPayrollBatchItemService.count({ where: { batchItem: { orderId: o8.id } } }), 0);
    const r8 = await create(rh, p8, [o8.id], k8); assert.equal(r8.status, 201, 'tras el rollback la misma clave genera normalmente');

    scenario('reversión completa ante error');
    // ---------------- cancelación concurrente frente a generación (generación primero)
    const o9 = await mkOrder(1); const p9 = await preview(rh, [o9.id], ref('g1'));
    const g9 = gate(); const reached9 = gate();
    const genFirst = gatedClient(db, { foodPayrollAssignment: { createMany: async () => { reached9.open(); await g9.wait(); } } });
    const genP = svc.createFoodPayrollBatch(rh, { payrollReference: p9.payrollReference, orderIds: [o9.id], previewToken: p9.previewToken }, qkey(), { db: genFirst });
    await reached9.wait();
    let cancelDone = false;
    const cancP = cancelFoodOrder(rh, { orderId: o9.id, reason: 'QA cancelación concurrente' }).finally(() => { cancelDone = true; });
    await sleep(400); assert.equal(cancelDone, false, 'la cancelación espera el bloqueo del pedido');
    g9.open();
    assert.equal((await genP).status, 201);
    await assert.rejects(cancP, /asignado a un lote/);
    assert.equal((await db.foodOrder.findUniqueOrThrow({ where: { id: o9.id } })).status, 'CONFIRMED');

    scenario('cancelación concurrente frente a generación (generación primero)');
    // ---------------- cancelación concurrente frente a generación (cancelación primero)
    const o10 = await mkOrder(2); const p10 = await preview(rh, [o10.id], ref('g2'));
    const g10 = gate(); const reached10 = gate();
    cancelGate = async () => { reached10.open(); await g10.wait(); };
    const cancFirst = cancelFoodOrder(rh, { orderId: o10.id, reason: 'QA cancelación primero' });
    await reached10.wait(); cancelGate = null;
    let genDone = false;
    const gen10 = create(rh, p10, [o10.id], qkey()).finally(() => { genDone = true; });
    await sleep(400); assert.equal(genDone, false, 'la generación espera el bloqueo del pedido');
    g10.open();
    await cancFirst;
    await assert.rejects(gen10, err => err.code === 'ORDER_NOT_ELIGIBLE' && JSON.stringify(err.details).includes('ORDER_CANCELLED'));
    assert.equal(await db.foodPayrollAssignment.count({ where: { orderId: o10.id } }), 0);

    scenario('cancelación concurrente frente a generación (cancelación primero)');
    // ---------------- cancelación excepcional restaurada (sin 42P01) y protección de pedidos asignados
    const o11 = await mkOrder(0);
    await cancelFoodOrder(rh, { orderId: o11.id, reason: 'QA cancelación excepcional restaurada' });
    assert.equal((await db.foodOrder.findUniqueOrThrow({ where: { id: o11.id } })).status, 'CANCELLED');
    await assert.rejects(cancelFoodOrder(rh, { orderId: o2.id, reason: 'QA pedido asignado' }), /asignado a un lote/);

    scenario('cancelación excepcional restaurada (sin 42P01) y protección de pedidos asignados');
    // ---------------- inmutabilidad de snapshots e historial (PostgreSQL)
    const guard = /YF_PAYROLL_GUARD/;
    const itemA = batchA.items[0];
    await assert.rejects(db.$executeRawUnsafe(`UPDATE "FoodPayrollBatchItem" SET "historicalUnitPrice" = 1 WHERE "id" = $1`, itemA.id), guard);
    await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "FoodPayrollBatchItem" WHERE "id" = $1`, itemA.id), guard);
    await assert.rejects(db.$executeRawUnsafe(`UPDATE "FoodPayrollBatchItemService" SET "menuItemName" = 'x' WHERE "batchId" = $1`, batchA.id), guard);
    await assert.rejects(db.$executeRawUnsafe(`UPDATE "FoodPayrollBatch" SET "committedAmount" = 1 WHERE "id" = $1`, batchA.id), guard);
    await assert.rejects(db.$executeRawUnsafe(`UPDATE "FoodPayrollBatch" SET "status" = 'RECONCILED' WHERE "id" = $1`, batchA.id), guard);
    await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "FoodPayrollBatch" WHERE "id" = $1`, batchA.id), guard);
    await assert.rejects(db.$executeRawUnsafe(`UPDATE "FoodPayrollAssignment" SET "status" = 'RELEASED', "releasedAt" = now(), "releasedById" = $2, "releaseReason" = 'QA intento' WHERE "batchId" = $1`, batchA.id, rh.id), guard);
    await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "FoodPayrollAssignment" WHERE "batchId" = $1`, batchA.id), guard);
    await assert.rejects(db.$executeRawUnsafe(`UPDATE "FoodPayrollAuditEvent" SET "reasonCode" = 'x' WHERE "batchId" = $1`, batchA.id), guard);
    await assert.rejects(db.$executeRawUnsafe(`UPDATE "FoodOrder" SET "unitPrice" = 1, "totalAmount" = 2 WHERE "id" = $1`, o1.id), guard);
    await assert.rejects(db.$executeRawUnsafe(`UPDATE "FoodOrder" SET "status" = 'CANCELLED' WHERE "id" = $1`, o1.id), guard);
    await assert.rejects(db.$executeRawUnsafe(`UPDATE "Reservation" SET "status" = 'CANCELLED' WHERE "foodOrderId" = $1`, o1.id), guard);
    await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "FoodPayrollAuditEvent" WHERE "batchId" = $1`, batchA.id), guard, 'sin bandera de limpieza no se borra');
    const afterGuard = await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: batchA.id }, include: { items: { orderBy: { id: 'asc' } } } });
    assert.equal(afterGuard.committedAmount.toString(), '215.75'); assert.equal(afterGuard.status, 'GENERATED');
    assert.deepEqual(afterGuard.items.map(i => i.historicalUnitPrice.toString()).sort(), ['18', '35.5', '42.25'].sort());
    scenario('inmutabilidad de snapshots e historial (PostgreSQL)');
    assert.equal(passed.length, 15, 'todos los escenarios ejecutados');
    console.log(`QA YF-002-A: escenarios=${passed.length} lotes=${await db.foodPayrollBatch.count({ where: { payrollReference: { startsWith: `QA-FIXTURE-${run}` } } })} verificados.`);
  } finally {
    // Limpieza de fixtures propios: bandera de transacción + base QA + referencia QA-FIXTURE (ver migración).
    try {
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL yellowflex.qa_fixture_cleanup = 'on'`);
        const batches = (await tx.foodPayrollBatch.findMany({ where: { payrollReference: { startsWith: `QA-FIXTURE-${run}` } }, select: { id: true } })).map(b => b.id);
        await tx.foodPayrollAuditEvent.deleteMany({ where: { OR: [{ batchId: { in: batches } }, { batchId: null, actorId: { in: userIds }, idempotencyKey: { startsWith: 'qa-fixture-' } }] } });
        await tx.foodPayrollAssignment.deleteMany({ where: { batchId: { in: batches } } });
        await tx.foodPayrollBatchItemService.deleteMany({ where: { batchId: { in: batches } } });
        await tx.foodPayrollBatchItem.deleteMany({ where: { batchId: { in: batches } } });
        await tx.foodPayrollBatch.deleteMany({ where: { id: { in: batches } } });
      }, { timeout: 60000 });
      await db.foodOrderCancellation.deleteMany({ where: { order: { menuWeekId: { in: weekIds } } } });
      await db.reservation.deleteMany({ where: { foodOrder: { menuWeekId: { in: weekIds } } } });
      await db.foodOrder.deleteMany({ where: { menuWeekId: { in: weekIds } } });
      await db.menuItem.deleteMany({ where: { menuDay: { menuWeekId: { in: weekIds } } } });
      await db.menuDay.deleteMany({ where: { menuWeekId: { in: weekIds } } });
      await db.menuWeek.deleteMany({ where: { id: { in: weekIds } } });
      await db.employee.deleteMany({ where: { id: { in: employeeIds } } });
      await db.corporateModulePermission.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      const residue = {
        batches: await db.foodPayrollBatch.count({ where: { payrollReference: { startsWith: `QA-FIXTURE-${run}` } } }),
        events: await db.foodPayrollAuditEvent.count({ where: { actorId: { in: userIds } } }),
        orders: await db.foodOrder.count({ where: { menuWeekId: { in: weekIds } } }),
        users: await db.user.count({ where: { name: { startsWith: marker } } }),
        employees: await db.employee.count({ where: { employeeNumber: { startsWith: marker } } }),
      };
      console.log('QA YF-002-A limpieza: ' + JSON.stringify(residue));
      assert.deepEqual(residue, { batches: 0, events: 0, orders: 0, users: 0, employees: 0 }, 'Limpieza de fixtures incompleta');
    } finally {
      if (prevSecret === undefined) delete process.env.FOOD_PAYROLL_PREVIEW_SECRET; else process.env.FOOD_PAYROLL_PREVIEW_SECRET = prevSecret;
      delete globalThis.prisma; await db.$disconnect();
    }
  }
});
