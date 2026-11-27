/* eslint-disable @typescript-eslint/no-require-imports */
// YF-003 · MATRIZ DE PRUEBAS de Almacén contra PostgreSQL aislado (127.0.0.1:55432/yellowflex_restore_test).
// Rutas API reales + repositorios reales + PostgreSQL real; sin mocks de base de datos ni de permisos (solo se sustituye la
// lectura de la cookie de sesión: ver tests/helpers/route-session.cjs). Fixtures con marcador QA-WH-MX-<uuid>; limpieza total.
// RUN_WAREHOUSE_YF003_DB_TESTS=1 node --require ./tests/helpers/server-only-register.cjs --import tsx --test tests/warehouse-yf003-matrix-postgres.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('./helpers/isolated-postgres.cjs');
const { installRouteSession, setSessionUser } = require('./helpers/route-session.cjs');

test('YF-003 matriz Almacén: integridad, idempotencia, concurrencia, permisos, control interno, reportes y limpieza', {
  skip: process.env.RUN_WAREHOUSE_YF003_DB_TESTS !== '1', timeout: 900000,
}, async (t) => {
  const url = configureIsolatedConnection();
  const { PrismaClient, Prisma } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  const marker = `QA-WH-MX-${randomUUID()}`;
  const ids = { users: [], warehouse: null, items: [] };
  const results = [];
  const ok = (id, name) => { results.push(id); t.diagnostic(`ESCENARIO OK ${id}: ${name}`); };
  try {
    await assertIsolatedIdentity(db);
    globalThis.prisma = db;
    installRouteSession();
    const [warehouseArea, productionArea] = await Promise.all([
      db.operationalArea.findUnique({ where: { code: 'ALMACEN' } }), db.operationalArea.findUnique({ where: { code: 'PRODUCCION' } })]);
    assert.ok(warehouseArea?.active && productionArea?.active, 'Faltan los catálogos estructurales ALMACEN y PRODUCCION; no se modifican');

    const route = p => require(`../app/api/${p}/route.ts`);
    const R = {
      receipts: route('warehouse/movements'), issues: route('warehouse/movements/issues'), transfers: route('warehouse/movements/transfers'),
      handoffs: route('warehouse/movements/handoffs'), reverse: route('warehouse/movements/[movementId]/reverse'),
      receive: route('warehouse/custodies/[custodyId]/receive'), consume: route('warehouse/custodies/[custodyId]/consume'),
      ret: route('warehouse/custodies/[custodyId]/return'), retReceive: route('warehouse/returns/[custodyId]/receive'),
      counts: route('warehouse/counts'), countComplete: route('warehouse/counts/[countId]/complete'), countCancel: route('warehouse/counts/[countId]/cancel'),
      disc: route('warehouse/discrepancies/[id]'), recount: route('warehouse/discrepancies/[id]/recounts'), recountDone: route('warehouse/recounts/[id]/complete'),
      approve: route('warehouse/discrepancies/[id]/approve'), reject: route('warehouse/discrepancies/[id]/reject'),
      kardex: route('warehouse/reports/kardex'), report: route('warehouse/reports/movements'), dashboard: route('warehouse/reports/dashboard'),
      recon: route('warehouse/reports/reconciliation'), inventory: route('warehouse/inventory'),
      whPerms: route('admin/cpanel/warehouse-permissions'), cpPerms: route('admin/cpanel/permissions'),
    };
    /** Llama una ruta como lo haría el navegador; la sesión se resuelve contra la base de datos en cada solicitud. */
    const api = async (userId, mod, method, { body, key, params, query = '' } = {}) => {
      setSessionUser(userId);
      const headers = { 'content-type': 'application/json' };
      if (key) headers['Idempotency-Key'] = key;
      const req = new Request(`http://qa.local/api${query}`, { method, headers, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body) });
      const res = await mod[method](req, { params: Promise.resolve(params ?? {}) });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text.replace(/^﻿/, '')); } catch { json = null; }
      return { status: res.status, json, text, headers: res.headers };
    };
    const K = () => randomUUID();

    // ---------------------------------------------------------------- fixtures
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
    const OPS = ['view', 'operate']; const VIEW = { canViewInventory: true };
    const U = {
      operador: await mkUser('operador', ['EMPLEADO'], OPS, { ...VIEW, canRegisterMovement: true }),
      operador2: await mkUser('operador2', ['EMPLEADO'], OPS, { ...VIEW, canRegisterMovement: true }),
      contador: await mkUser('contador', ['EMPLEADO'], OPS, { ...VIEW, canRegisterMovement: true }),
      supervisor: await mkUser('supervisor', ['EMPLEADO'], OPS, { ...VIEW, canManageWarehouse: true }),
      supervisor2: await mkUser('supervisor2', ['EMPLEADO'], OPS, { ...VIEW, canManageWarehouse: true }),
      aprobador: await mkUser('aprobador', ['EMPLEADO'], ['view', 'approve'], { ...VIEW, canApproveWarehouseAdjustments: true }),
      aprobadorInvestigador: await mkUser('aprobador-investigador', ['EMPLEADO'], ['view', 'operate', 'approve'], { ...VIEW, canManageWarehouse: true, canApproveWarehouseAdjustments: true }),
      aprobador2: await mkUser('aprobador2', ['EMPLEADO'], ['view', 'approve'], { ...VIEW, canApproveWarehouseAdjustments: true }),
      consulta: await mkUser('consulta', ['EMPLEADO'], ['view'], VIEW),
      auditor: await mkUser('auditor', ['EMPLEADO'], ['audit']),
      produccion: await mkUser('produccion', ['PRODUCCION'], OPS),
      sinPermiso: await mkUser('sin-permiso', ['EMPLEADO']),
      admin: await mkUser('admin', ['ADMIN']),
      admin2: await mkUser('admin2', ['ADMIN']),
      direccion: await mkUser('direccion', ['DIRECCION']),
      rh: await mkUser('rh-delegado', ['RH'], ['c-panel/manage']),
      rhSinDelegacion: await mkUser('rh-sin-delegacion', ['RH']),
      objetivo: await mkUser('objetivo', ['EMPLEADO']),
    };
    const wh = await db.warehouse.create({ data: { code: marker.slice(0, 40), name: `${marker} almacén` } }); ids.warehouse = wh.id;
    const mkLoc = (code, active = true) => db.warehouseLocation.create({ data: { warehouseId: wh.id, code, name: `${marker} ${code}`, active } });
    const [L1, L2, L3, LX] = [await mkLoc('A-1-1'), await mkLoc('A-1-18'), await mkLoc('B-2-1'), await mkLoc('Z-9-9', false)];
    const mkItem = async (suffix, unit, active = true) => { const i = await db.inventoryItem.create({ data: { code: `${marker}-${suffix}`, description: `${marker} ${suffix} ficticio`, baseUnit: unit, active } }); ids.items.push(i.id); return i; };
    const I1 = await mkItem('PZ', 'PZ'); const I2 = await mkItem('KG', 'KG'); const IX = await mkItem('INACTIVO', 'PZ', false); const IB = await mkItem('VOLUMEN', 'PZ');
    const { getWarehouseStockBalance } = require('../repositories/warehouse-stock-lock.ts');
    const bal = async (item, loc) => (await getWarehouseStockBalance(db, item.id, loc.id)).toString();
    const movCount = item => db.inventoryMovement.count({ where: { itemId: item.id } });
    const receipt = (user, item, loc, quantity, key = K(), extra = {}) => api(user, R.receipts, 'POST', { key, body: { itemId: item.id, destinationLocationId: loc.id, quantity, referenceType: 'QA', referenceNumber: marker, ...extra } });

    // ================================================================ 1-8 Entradas y validaciones
    {
      const r = await receipt(U.operador, I1, L1, '20');
      assert.equal(r.status, 201, r.text); assert.equal(await bal(I1, L1), '20');
      ok('M01', 'entrada válida: 201, un movimiento, existencia 20');
      const key = K(); const a = await receipt(U.operador, I1, L1, '5', key); const b = await receipt(U.operador, I1, L1, '5', key);
      assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(b.json.replayed, true); assert.equal(a.json.movement.folio, b.json.movement.folio);
      assert.equal(await bal(I1, L1), '25');
      ok('M02', 'entrada duplicada con la misma clave: un solo movimiento, se devuelve el original (replayed)');
      for (const q of ['0', 0, '0.000']) assert.equal((await receipt(U.operador, I1, L1, q)).status, 400);
      ok('M03', 'cantidad cero rechazada (400)');
      for (const q of ['-1', -5, '-0.001']) assert.equal((await receipt(U.operador, I1, L1, q)).status, 400);
      ok('M04', 'cantidad negativa rechazada (400)');
      for (const q of ['1.0001', '0.0005', '1e3', 'abc', '', null, [1], '9999999999999999']) assert.equal((await receipt(U.operador, I1, L1, q)).status, 400, String(q));
      assert.equal(await bal(I1, L1), '25');
      ok('M05', 'precisión inválida, notación científica, texto, vacío y más de 15 enteros rechazados sin movimiento');
      assert.equal((await api(U.operador, R.receipts, 'POST', { key: K(), body: { itemId: 'no-existe', destinationLocationId: L1.id, quantity: '1' } })).status, 400);
      ok('M06', 'artículo inexistente rechazado');
      assert.equal((await api(U.operador, R.receipts, 'POST', { key: K(), body: { itemId: I1.id, destinationLocationId: 'no-existe', quantity: '1' } })).status, 400);
      assert.equal((await receipt(U.operador, I1, LX, '1')).status, 400, 'ubicación inactiva');
      ok('M07', 'ubicación inexistente o inactiva rechazada');
      assert.equal((await receipt(U.operador, IX, L1, '1')).status, 400);
      ok('M08', 'artículo inactivo rechazado');
    }

    // ================================================================ 9-11 Salidas
    const issue = (user, item, loc, quantity, key = K(), extra = {}) => api(user, R.issues, 'POST', { key, body: { itemId: item.id, originLocationId: loc.id, quantity,
      reason: 'Envío a proveedor por garantía', destination: 'Proveedor QA', referenceNumber: `${marker}-SAL`, ...extra } });
    {
      const r = await issue(U.operador, I1, L1, '3');
      assert.equal(r.status, 201, r.text); assert.equal(await bal(I1, L1), '22');
      assert.equal((await issue(U.operador, I1, L1, '1', K(), { reason: 'corto' })).status, 409, 'motivo obligatorio');
      assert.equal((await issue(U.operador, I1, L1, '1', K(), { referenceNumber: '' })).status, 409, 'referencia obligatoria');
      ok('M09', 'salida válida con motivo, destino y referencia obligatorios');
      const over = await issue(U.operador, I1, L1, '22.001');
      assert.equal(over.status, 409); assert.match(over.json.error, /Existencia insuficiente/); assert.equal(await bal(I1, L1), '22');
      ok('M10', 'salida superior a la existencia rechazada sin efecto');
      const res = await Promise.all([issue(U.operador, I1, L1, '15'), issue(U.operador2, I1, L1, '15')]);
      assert.deepEqual(res.map(r => r.status).sort(), [201, 409]); assert.equal(await bal(I1, L1), '7');
      ok('M11', 'dos salidas simultáneas sobre la misma existencia: solo una procede, nunca saldo negativo');
    }

    // ================================================================ 12-16 Transferencias
    const transfer = (user, item, from, to, quantity, key = K()) => api(user, R.transfers, 'POST', { key, body: { itemId: item.id, originLocationId: from.id, destinationLocationId: to.id, quantity } });
    {
      await receipt(U.operador, I1, L1, '13');
      const totalBefore = Number(await bal(I1, L1)) + Number(await bal(I1, L2));
      const r = await transfer(U.operador, I1, L1, L2, '5');
      assert.equal(r.status, 201, r.text); assert.equal(await bal(I1, L1), '15'); assert.equal(await bal(I1, L2), '5');
      assert.equal(Number(await bal(I1, L1)) + Number(await bal(I1, L2)), totalBefore, 'la transferencia no cambia el total');
      ok('M12', 'transferencia válida A-1-1 → A-1-18 sin alterar la existencia total');
      assert.equal((await transfer(U.operador, I1, L1, L1, '1')).status, 400);
      ok('M13', 'transferencia a la misma ubicación rechazada');
      const key = K(); const a = await transfer(U.operador, I1, L1, L2, '2', key); const b = await transfer(U.operador, I1, L1, L2, '2', key);
      assert.equal(a.json.movement.folio, b.json.movement.folio); assert.equal(await bal(I1, L2), '7');
      ok('M14', 'transferencia duplicada con la misma clave: un solo movimiento');
      const many = await Promise.all(Array.from({ length: 5 }, () => transfer(U.operador, I1, L1, L3, '4')));
      assert.equal(many.filter(r => r.status === 201).length, 3); assert.equal(await bal(I1, L1), '1'); assert.equal(await bal(I1, L3), '12');
      ok('M15', 'cinco transferencias simultáneas de 4 con existencia 13: proceden exactamente 3, saldo 1, nunca negativo');
      const opposite = await Promise.all([transfer(U.operador, I1, L2, L3, '7'), transfer(U.operador2, I1, L3, L2, '12')]);
      assert.deepEqual(opposite.map(r => r.status), [201, 201]); assert.equal(await bal(I1, L2), '12'); assert.equal(await bal(I1, L3), '7');
      ok('M16', 'transferencias simultáneas en sentidos opuestos: sin interbloqueo y con saldos correctos');
    }

    // ================================================================ 17-19 Reversos
    {
      const r = await receipt(U.operador, I1, L1, '4');
      const mov = await db.inventoryMovement.findUnique({ where: { folio: r.json.movement.folio } });
      const self = await api(U.supervisor, R.reverse, 'POST', { key: K(), params: { movementId: mov.id }, body: { reason: 'Captura duplicada del proveedor' } });
      assert.equal(self.status, 201, self.text); assert.equal(await bal(I1, L1), '1');
      const rev = await db.inventoryMovement.findUnique({ where: { folio: self.json.reversal.reversalFolio } });
      assert.equal(rev.referenceType, 'REVERSO'); assert.equal(rev.referenceNumber, mov.folio); assert.equal(rev.type, 'EXTERNAL_ISSUE');
      assert.ok(await db.inventoryMovement.findUnique({ where: { id: mov.id } }), 'el original se conserva');
      ok('M17', 'reverso válido de una entrada: movimiento compensatorio trazable, original intacto');
      const again = await api(U.supervisor2, R.reverse, 'POST', { key: K(), params: { movementId: mov.id }, body: { reason: 'Intento de segundo reverso' } });
      assert.equal(again.status, 409); assert.match(again.json.error, /ya fue revertido/);
      const rk = K(); const r1 = await api(U.supervisor, R.reverse, 'POST', { key: rk, params: { movementId: mov.id }, body: { reason: 'Captura duplicada del proveedor' } });
      assert.equal(r1.status, 409);
      const notRev = await api(U.supervisor, R.reverse, 'POST', { key: K(), params: { movementId: rev.id }, body: { reason: 'Revertir el reverso' } });
      assert.equal(notRev.status, 409);
      ok('M18', 'reverso duplicado (otro usuario u otra clave) rechazado; un reverso no se revierte');
      const r2 = await receipt(U.operador, I1, L2, '3');
      const m2 = await db.inventoryMovement.findUnique({ where: { folio: r2.json.movement.folio } });
      await issue(U.operador, I1, L2, '15');
      const unavailable = await api(U.supervisor, R.reverse, 'POST', { key: K(), params: { movementId: m2.id }, body: { reason: 'Recepción equivocada' } });
      assert.equal(unavailable.status, 409); assert.match(unavailable.json.error, /ya no está disponible/); assert.equal(await bal(I1, L2), '0');
      const own = await api(U.operador, R.reverse, 'POST', { key: K(), params: { movementId: m2.id }, body: { reason: 'Recepción equivocada' } });
      assert.equal(own.status, 403, 'operar no basta para revertir');
      ok('M19', 'reverso cuando el material ya no está disponible: rechazado sin saldo negativo; operar no autoriza reversos');
    }

    // ================================================================ 20-30 Producción: entrega, recepción, consumo, devolución
    const handoff = (user, item, loc, quantity, key = K()) => api(user, R.handoffs, 'POST', { key, body: { itemId: item.id, originLocationId: loc.id, quantity, referenceType: 'OP', referenceNumber: `${marker}-OP` } });
    const custodyOf = async folio => db.inventoryCustody.findUnique({ where: { folio } });
    {
      await receipt(U.operador, I2, L1, '10.500');
      const h = await handoff(U.operador, I2, L1, '4.250');
      assert.equal(h.status, 201, h.text); assert.equal(await bal(I2, L1), '6.25');
      const c = await custodyOf(h.json.custody.folio); assert.equal(c.status, 'IN_TRANSIT');
      ok('M20', 'entrega a Producción: sale de la ubicación y queda en tránsito (no es consumo)');
      const k = K(); const dup = await Promise.all([handoff(U.operador, I2, L1, '1', k), handoff(U.operador, I2, L1, '1', k), handoff(U.operador, I2, L1, '1', k)]);
      assert.equal(new Set(dup.map(r => r.json.custody.folio)).size, 1); assert.equal(await bal(I2, L1), '5.25');
      ok('M21', 'entrega duplicada (triple clic simultáneo): una custodia y un movimiento');
      // Cancelación (reverso) de una entrega aún no recibida: regresa a su ubicación original y cierra la custodia.
      const hx = await handoff(U.operador, I2, L1, '0.25'); assert.equal(await bal(I2, L1), '5');
      const hxMov = await db.inventoryMovement.findUnique({ where: { folio: hx.json.movement.folio } });
      const cancel = await api(U.supervisor, R.reverse, 'POST', { key: K(), params: { movementId: hxMov.id }, body: { reason: 'Entrega registrada por error' } });
      assert.equal(cancel.status, 201, cancel.text); assert.equal(await bal(I2, L1), '5.25');
      const hxc = await custodyOf(hx.json.custody.folio); assert.equal(hxc.status, 'CLOSED'); assert.equal(hxc.quantity.toString(), '0');
      const back = await db.inventoryMovement.findUnique({ where: { folio: cancel.json.reversal.reversalFolio } });
      assert.equal(back.type, 'OPERATIONAL_RETURN'); assert.equal(back.referenceType, 'REVERSO'); assert.equal(back.referenceNumber, hxMov.folio);
      const receivedMov = await db.inventoryMovement.findUnique({ where: { folio: h.json.movement.folio } });
      ok('M21b', 'cancelación de entrega no recibida: regreso trazable a la ubicación original y custodia cerrada');
      const late = { receivedMov };
      const partial = await api(U.produccion, R.receive, 'POST', { key: K(), params: { custodyId: c.id }, body: { receivedQuantity: '4' } });
      assert.equal(partial.status, 409); assert.match(partial.json.error, /diferencia/);
      ok('M22', 'recepción parcial: se rechaza por política (la diferencia se investiga antes de aceptar la custodia)');
      const rk = K();
      const rec = await Promise.all([1, 2].map(() => api(U.produccion, R.receive, 'POST', { key: rk, params: { custodyId: c.id }, body: { receivedQuantity: '4.25' } })));
      assert.deepEqual(rec.map(r => r.status).sort(), [200, 201]);
      assert.equal(await db.inventoryCustodyEvent.count({ where: { custodyId: c.id, type: 'RECEIVED' } }), 1);
      const other = await api(U.produccion, R.receive, 'POST', { key: K(), params: { custodyId: c.id }, body: { receivedQuantity: '4.25' } });
      assert.equal(other.status, 409);
      ok('M23', 'recepción duplicada: misma clave → mismo resultado; otra clave → rechazo; un solo evento RECEIVED');
      const lateCancel = await api(U.supervisor, R.reverse, 'POST', { key: K(), params: { movementId: late.receivedMov.id }, body: { reason: 'Intento de cancelar entrega ya recibida' } });
      assert.equal(lateCancel.status, 409); assert.match(lateCancel.json.error, /no fue recibida/);
      ok('M23b', 'una entrega ya recibida por Producción no se cancela (se devuelve por el flujo de devolución)');
      const consume = (q, key = K()) => api(U.produccion, R.consume, 'POST', { key, params: { custodyId: c.id }, body: { quantity: q, referenceNumber: `${marker}-OP` } });
      const c1 = await consume(0.25); assert.equal(c1.status, 200, c1.text); assert.equal(c1.json.remaining, 4);
      ok('M24', 'consumo parcial: la custodia conserva el resto');
      assert.equal((await consume(4.001)).status, 409);
      ok('M26', 'consumo superior a la custodia rechazado');
      const ret = await api(U.produccion, R.ret, 'POST', { key: K(), params: { custodyId: c.id }, body: { quantity: '1.5' } });
      assert.equal(ret.status, 201, ret.text); assert.equal(ret.json.partial, true); assert.equal(ret.json.remainingInProduction, 2.5);
      ok('M27', 'devolución parcial: custodia de devolución separada; el resto sigue disponible en Producción');
      assert.equal((await api(U.produccion, R.ret, 'POST', { key: K(), params: { custodyId: c.id }, body: { quantity: '2.501' } })).status, 409);
      ok('M29', 'devolución superior a lo disponible rechazada');
      const racers = await Promise.all([consume(2.5), api(U.produccion, R.ret, 'POST', { key: K(), params: { custodyId: c.id }, body: { quantity: '2.5' } })]);
      assert.equal(racers.filter(r => r.status === 200 || r.status === 201).length, 1, 'solo una de las dos operaciones toma la misma cantidad');
      const after = await db.inventoryCustody.findUnique({ where: { id: c.id } });
      if (racers[0].status === 200) { assert.equal(after.status, 'CLOSED'); assert.equal(after.quantity.toString(), '0'); }
      else { assert.equal(after.status, 'RETURN_IN_TRANSIT'); assert.equal(after.quantity.toString(), '2.5'); }
      ok('M30', 'consumo y devolución simultáneos de la misma cantidad: solo uno procede');
      // Consumo total con aritmética decimal exacta (0.3 − 0.1 − 0.2 = 0 cierra la custodia).
      await receipt(U.operador, I2, L3, '1');
      const h2 = await handoff(U.operador, I2, L3, '0.3'); const c2 = await custodyOf(h2.json.custody.folio);
      await api(U.produccion, R.receive, 'POST', { key: K(), params: { custodyId: c2.id }, body: { receivedQuantity: '0.3' } });
      for (const q of [0.1, 0.2]) assert.equal((await api(U.produccion, R.consume, 'POST', { key: K(), params: { custodyId: c2.id }, body: { quantity: q, referenceNumber: 'OP' } })).status, 200);
      const closed = await db.inventoryCustody.findUnique({ where: { id: c2.id } });
      assert.equal(closed.status, 'CLOSED'); assert.equal(closed.quantity.toString(), '0');
      ok('M25', 'consumo total exacto (0.1 + 0.2 de 0.3) cierra la custodia sin residuos de punto flotante');
      // Devolución total y su recepción en Almacén (idempotente).
      const h3 = await handoff(U.operador, I2, L3, '0.7'); const c3 = await custodyOf(h3.json.custody.folio);
      await api(U.produccion, R.receive, 'POST', { key: K(), params: { custodyId: c3.id }, body: { receivedQuantity: '0.7' } });
      const total = await api(U.produccion, R.ret, 'POST', { key: K(), params: { custodyId: c3.id }, body: {} });
      assert.equal(total.json.partial, false);
      const before = Number(await bal(I2, L3)); const rrk = K();
      const rr = await Promise.all([1, 2].map(() => api(U.operador, R.retReceive, 'POST', { key: rrk, params: { custodyId: c3.id }, body: { receivedQuantity: '0.7', destinationLocationId: L3.id } })));
      assert.equal(new Set(rr.map(r => r.json.movementFolio)).size, 1); assert.equal(Number(await bal(I2, L3)), before + 0.7);
      ok('M28', 'devolución total y recepción idempotente en Almacén: un solo movimiento de regreso');
    }

    // ================================================================ 31-40 Conteos, diferencias, ajustes
    const launch = (user, item, loc, key = K()) => api(user, R.counts, 'POST', { key, body: { itemId: item.id, locationId: loc.id, type: 'CYCLE' } });
    const complete = (user, countId, q, key = K()) => api(user, R.countComplete, 'POST', { key, params: { countId }, body: { countedQuantity: q } });
    {
      // I1 en L3 tiene 7.
      const l1 = await launch(U.contador, I1, L3); assert.equal(l1.status, 201, l1.text);
      const done = await complete(U.contador, l1.json.id, '7'); assert.equal(done.status, 201, done.text); assert.equal(done.json.difference, 0); assert.equal(done.json.discrepancyFolio, null);
      ok('M31', 'conteo correcto: sin diferencia ni expediente, sin movimiento');
      const k = K(); const dupLaunch = await Promise.all([launch(U.contador, I1, L3, k), launch(U.contador, I1, L3, k), launch(U.contador, I1, L3, K())]);
      assert.equal(new Set(dupLaunch.filter(r => r.status < 300).map(r => r.json.id)).size, 1); assert.ok(dupLaunch.some(r => r.status === 409));
      const countId = dupLaunch.find(r => r.status < 300).json.id;
      const movesBefore = await movCount(I1);
      const ck = K(); const two = await Promise.all([complete(U.contador, countId, '5', ck), complete(U.contador, countId, '5', ck)]);
      assert.deepEqual(two.map(r => r.status).sort(), [200, 201]); assert.equal(two[0].json.difference, -2);
      assert.equal(await movCount(I1), movesBefore, 'una diferencia no modifica el inventario');
      const discrepancy = await db.warehouseDiscrepancy.findFirst({ where: { count: { id: countId } } });
      assert.ok(discrepancy); assert.equal(await db.warehouseDiscrepancyEvent.count({ where: { discrepancyId: discrepancy.id, type: 'DETECTED' } }), 1);
      ok('M32', 'conteo con diferencia (lanzamiento y cierre duplicados): un conteo, un expediente, cero movimientos');
      // Conteo desactualizado.
      const stale = await launch(U.contador, I1, L2);
      await receipt(U.operador, I1, L2, '1');
      const st = await complete(U.contador, stale.json.id, '13');
      assert.equal(st.status, 409); assert.match(st.json.error, /cambió desde que inició el conteo/);
      assert.equal((await api(U.contador, R.countCancel, 'POST', { params: { countId: stale.json.id }, body: { reason: 'Conteo desactualizado por recepción' } })).status, 200);
      ok('M34', 'conteo desactualizado: no puede cerrarse ni producir ajuste; se cancela con motivo');
      // Investigación.
      const upd = (user, body, key = K()) => api(user, R.disc, 'PATCH', { key, params: { id: discrepancy.id }, body });
      assert.equal((await upd(U.operador, { classification: 'REAL', cause: 'x', notes: '', resolution: 'y' })).status, 403, 'operar no autoriza investigar');
      const inv = await upd(U.supervisor, { classification: 'REAL', cause: 'Merma en manipulación', notes: 'Revisión física', resolution: 'Ajustar a físico' });
      assert.equal(inv.status, 201, inv.text);
      assert.equal((await upd(U.supervisor, { classification: 'REAL', cause: 'c', notes: '', resolution: 'r', close: true })).status, 409, 'una diferencia REAL no se cierra sin ajuste aprobado');
      ok('M35', 'investigación: clasificación REAL con causa y resolución, historial registrado, sin cerrar sin aprobación');
      const early = await api(U.aprobador, R.approve, 'POST', { key: K(), params: { id: discrepancy.id } });
      assert.equal(early.status, 409); assert.match(early.json.error, /reconteo completado/);
      const rq = await api(U.supervisor, R.recount, 'POST', { key: K(), params: { id: discrepancy.id }, body: { reason: 'Confirmar diferencia física' } });
      assert.equal(rq.status, 201, rq.text);
      const recByCounter = await api(U.contador, R.recountDone, 'POST', { key: K(), params: { id: rq.json.id }, body: { countedQuantity: '5' } });
      assert.equal(recByCounter.status, 403, 'el contador original no tiene permiso de reconteo');
      const rc = await api(U.supervisor2, R.recountDone, 'POST', { key: K(), params: { id: rq.json.id }, body: { countedQuantity: '5' } });
      assert.equal(rc.status, 201, rc.text); assert.equal(rc.json.difference, -2);
      ok('M33', 'reconteo independiente: solicitado por el investigador y capturado por otra persona');
      // Rechazo y reapertura.
      const rej = await api(U.aprobador, R.reject, 'POST', { key: K(), params: { id: discrepancy.id }, body: { reason: 'Falta evidencia del área' } });
      assert.equal(rej.status, 201, rej.text);
      const after = await api(U.aprobador2, R.approve, 'POST', { key: K(), params: { id: discrepancy.id } });
      assert.equal(after.status, 409); assert.match(after.json.error, /reconteo nuevo/);
      assert.equal(await movCount(I1), movesBefore + 1, 'el rechazo no mueve inventario (solo la recepción del escenario 34)');
      ok('M37', 'ajuste rechazado: sin movimiento; el expediente vuelve a investigación y exige reconteo nuevo');
      const rq2 = await api(U.supervisor, R.recount, 'POST', { key: K(), params: { id: discrepancy.id }, body: { reason: 'Reconteo tras rechazo' } });
      await api(U.supervisor2, R.recountDone, 'POST', { key: K(), params: { id: rq2.json.id }, body: { countedQuantity: '5' } });
      // Autoaprobación y participantes.
      const selfApprove = await api(U.aprobadorInvestigador, R.disc, 'PATCH', { key: K(), params: { id: discrepancy.id }, body: { classification: 'REAL', cause: 'Merma en manipulación', notes: 'Nota del aprobador', resolution: 'Ajustar a físico' } });
      assert.equal(selfApprove.status, 201);
      // Otro investigador actualiza después: el aprobador-investigador ya NO es el último asignado, pero sí participó.
      assert.equal((await upd(U.supervisor, { classification: 'REAL', cause: 'Merma en manipulación', notes: 'Revisión final', resolution: 'Ajustar a físico' })).status, 201);
      const sa = await api(U.aprobadorInvestigador, R.approve, 'POST', { key: K(), params: { id: discrepancy.id } });
      assert.equal(sa.status, 409); assert.match(sa.json.error, /investig|Participaste/);
      const rej2 = await api(U.aprobadorInvestigador, R.reject, 'POST', { key: K(), params: { id: discrepancy.id }, body: { reason: 'Intento de decidir lo propio' } });
      assert.equal(rej2.status, 409);
      ok('M39', 'autoaprobación bloqueada: quien participó en cualquier momento de la investigación (aunque ya no sea el último asignado) no aprueba ni rechaza');
      // Aprobaciones concurrentes de dos aprobadores independientes.
      const ap = await Promise.all([U.aprobador, U.aprobador2].map(u => api(u, R.approve, 'POST', { key: K(), params: { id: discrepancy.id } })));
      assert.deepEqual(ap.map(r => r.status).sort(), [201, 409]);
      const winner = ap.find(r => r.status === 201).json.movement;
      assert.equal(winner.type, 'ADJUSTMENT_OUT'); assert.equal(winner.quantity, 2); assert.equal(winner.previousQuantity, 7); assert.equal(winner.newQuantity, 5);
      assert.equal(await bal(I1, L3), '5');
      const adj = await db.inventoryMovement.findUnique({ where: { folio: winner.movementFolio } });
      assert.equal(adj.referenceType, 'WAREHOUSE_DISCREPANCY'); assert.match(adj.notes, /existencia anterior 7, posterior 5/);
      ok('M36', 'ajuste autorizado: movimiento trazable con referencia, existencia anterior y posterior, aprobador independiente');
      ok('M40', 'dos aprobaciones simultáneas: exactamente un ajuste');
      const replay = await api(U.aprobador, R.approve, 'POST', { key: K(), params: { id: discrepancy.id } });
      assert.equal(replay.status, 409);
      assert.equal(await db.inventoryMovement.count({ where: { referenceType: 'WAREHOUSE_DISCREPANCY', referenceNumber: discrepancy.folio } }), 1);
      ok('M38', 'ajuste duplicado rechazado: un solo movimiento por expediente');
    }

    // ================================================================ 41-55 Permisos (API real + PostgreSQL)
    {
      const { getWarehouseCapabilities } = require('../lib/warehouse/capabilities.ts');
      const caps = id => getWarehouseCapabilities(id, db);
      for (const u of [U.sinPermiso, U.rhSinDelegacion, U.objetivo]) {
        assert.equal((await api(u, R.inventory, 'GET')).status, 403);
        assert.equal((await receipt(u, I1, L1, '1')).status, 403);
      }
      assert.equal((await api(null, R.inventory, 'GET')).status, 401);
      ok('M41', 'usuario sin permiso (y sin sesión): 403/401 en consulta y en escritura');
      assert.equal((await api(U.consulta, R.inventory, 'GET')).status, 200);
      assert.equal((await api(U.consulta, R.kardex, 'GET', { query: `?itemId=${I1.id}` })).status, 200);
      assert.equal((await receipt(U.consulta, I1, L1, '1')).status, 403);
      assert.equal((await api(U.consulta, R.recon, 'GET')).status, 403, 'consultar no es auditar');
      ok('M42', 'permiso de consulta: lee inventario y Kardex; no escribe ni accede a la reconciliación');
      const opCaps = await caps(U.operador);
      assert.deepEqual([opCaps.operate, opCaps.investigate, opCaps.approve], [true, false, false]);
      ok('M43', 'permiso operativo: registra movimientos; no investiga ni aprueba');
      const supCaps = await caps(U.supervisor);
      assert.deepEqual([supCaps.investigate, supCaps.approve], [true, false]);
      ok('M44', 'permiso de investigación: investiga, reconteos y reversos; no aprueba');
      assert.equal((await caps(U.aprobador)).approve, true); assert.equal((await caps(U.aprobador)).operate, false);
      ok('M45', 'permiso de aprobación: aprueba o rechaza ajustes; no opera');
      assert.equal((await api(U.auditor, R.recon, 'GET')).status, 200);
      assert.equal((await api(U.auditor, R.report, 'GET', { query: `?itemId=${I1.id}` })).status, 200);
      for (const call of [receipt(U.auditor, I1, L1, '1'), issue(U.auditor, I1, L1, '1'), launch(U.auditor, I1, L1)]) assert.equal((await call).status, 403);
      ok('M46', 'auditor: consulta, Kardex, reportes y reconciliación; cualquier modificación 403');
      const adminCaps = await caps(U.admin);
      assert.deepEqual(adminCaps, { view: true, operate: false, investigate: false, approve: false, audit: true, production: false, productionView: true, catalog: false });
      assert.equal((await receipt(U.admin, I1, L1, '1')).status, 403);
      ok('M47', 'ADMIN sin permiso operativo explícito: supervisa y audita, no modifica inventario');
      assert.ok(Object.values(await caps(U.direccion)).every(v => v === false));
      assert.equal((await api(U.direccion, R.approve, 'POST', { key: K(), params: { id: 'cualquiera' } })).status, 403);
      ok('M48', 'Dirección sin permiso sensible explícito: no aprueba ajustes por su rol');
      const prodCaps = await caps(U.produccion);
      assert.deepEqual([prodCaps.view, prodCaps.operate, prodCaps.production], [false, false, true]);
      ok('M48b', 'Producción recibe y consume material sin adquirir facultades generales de Almacén');

      // RH delegado.
      const flag = (actor, userId, f, granted, reason = 'Alta operativa autorizada') => api(actor, R.whPerms, 'PATCH', { body: { userId, flag: f, granted, reason } });
      const audits = () => db.corporatePermissionAudit.count({ where: { targetId: U.objetivo } });
      const a0 = await audits();
      assert.equal((await flag(U.rh, U.objetivo, 'canViewInventory', true)).status, 200);
      assert.equal((await flag(U.rh, U.objetivo, 'canRegisterMovement', true)).status, 200);
      const cp = await api(U.rh, R.cpPerms, 'PATCH', { body: { userId: U.objetivo, moduleKey: 'warehouse', actionKey: 'view', granted: true, reason: 'Alta operativa autorizada' } });
      assert.equal(cp.status, 200, cp.text);
      await api(U.rh, R.cpPerms, 'PATCH', { body: { userId: U.objetivo, moduleKey: 'warehouse', actionKey: 'operate', granted: true, reason: 'Alta operativa autorizada' } });
      assert.equal(await audits(), a0 + 4);
      const entry = await db.corporatePermissionAudit.findFirst({ where: { targetId: U.objetivo, actionKey: 'operativo:canRegisterMovement' } });
      assert.equal(entry.actorId, U.rh); assert.equal(entry.oldGranted, false, 'permiso anterior registrado'); assert.equal(entry.newGranted, true); assert.equal(entry.reason, 'Alta operativa autorizada');
      assert.equal((await receipt(U.objetivo, I1, L1, '1')).status, 201, 'el usuario habilitado por RH opera');
      assert.equal((await api(U.rhSinDelegacion, R.whPerms, 'PATCH', { body: { userId: U.objetivo, flag: 'canViewInventory', granted: false, reason: 'Intento sin delegación' } })).status, 403);
      ok('M49', 'RH delegado asigna permisos ordinarios (C-PANEL y operativos) con auditoría completa; RH sin delegación no puede');
      for (const f of ['canApproveWarehouseAdjustments', 'canManageWarehouse', 'canImportInitial', 'canManageCatalog']) assert.equal((await flag(U.rh, U.objetivo, f, true)).status, 403);
      for (const a of ['approve', 'audit']) assert.equal((await api(U.rh, R.cpPerms, 'PATCH', { body: { userId: U.objetivo, moduleKey: 'warehouse', actionKey: a, granted: true, reason: 'Intento sensible' } })).status, 403);
      for (const target of [U.admin, U.direccion]) assert.equal((await flag(U.rh, target, 'canViewInventory', true)).status, 403);
      assert.equal((await api(U.rh, R.cpPerms, 'PATCH', { body: { userId: U.operador, moduleKey: 'c-panel', actionKey: 'manage', granted: true, reason: 'Elevar facultades' } })).status, 403);
      assert.equal((await caps(U.objetivo)).approve, false);
      ok('M50', 'RH no asigna permisos sensibles, no toca ADMIN/Dirección y no delega administración de permisos');
      for (const [actor, f] of [[U.rh, 'canViewInventory'], [U.admin, 'canApproveWarehouseAdjustments']]) assert.equal((await flag(actor, actor, f, true)).status, 403);
      assert.equal((await api(U.admin, R.cpPerms, 'PATCH', { body: { userId: U.admin, moduleKey: 'warehouse', actionKey: 'approve', granted: true, reason: 'Autoasignación' } })).status, 403);
      assert.equal((await caps(U.admin)).approve, false);
      ok('M51', 'nadie se otorga permisos a sí mismo (RH ni ADMIN), ni operativos ni C-PANEL');
      // Revocación con sesión activa: sin caché, la siguiente solicitud ya se rechaza.
      assert.equal((await flag(U.admin2, U.objetivo, 'canRegisterMovement', false, 'Baja operativa por cambio de área')).status, 200);
      assert.equal((await receipt(U.objetivo, I1, L1, '1')).status, 403);
      assert.equal((await api(U.objetivo, R.inventory, 'GET')).status, 200, 'conserva la consulta');
      ok('M52', 'revocación con sesión activa: la siguiente operación se rechaza de inmediato');
      const direct = [[R.issues, 'POST'], [R.counts, 'POST'], [R.recon, 'GET'], [R.dashboard, 'GET'], [R.whPerms, 'GET']];
      for (const [mod, m] of direct) assert.ok([401, 403].includes((await api(U.sinPermiso, mod, m, { key: K(), body: {}, query: `?userId=${U.operador}` })).status));
      ok('M53', 'acceso directo a APIs sin autorización: 401/403 antes de leer datos');
      const foreign = await api(U.operador, R.countComplete, 'POST', { key: K(), params: { countId: 'inexistente' }, body: { countedQuantity: '1' } });
      assert.equal(foreign.status, 409);
      const badCustody = await api(U.produccion, R.consume, 'POST', { key: K(), params: { custodyId: 'inexistente' }, body: { quantity: 1, referenceNumber: 'OP' } });
      assert.equal(badCustody.status, 409);
      const crossItem = await api(U.operador, R.transfers, 'POST', { key: K(), body: { itemId: I1.id, originLocationId: LX.id, destinationLocationId: L1.id, quantity: '1' } });
      assert.equal(crossItem.status, 400);
      ok('M54', 'manipulación de identificadores (inexistentes o inactivos): rechazo controlado, sin efectos');
      const manip = [{ quantity: '1,5' }, { quantity: '1 ' + '0' }, { quantity: { $gt: 0 } }, { quantity: true }, { quantity: '0x10' }, { quantity: 'Infinity' }];
      for (const b of manip) assert.equal((await api(U.operador, R.receipts, 'POST', { key: K(), body: { itemId: I1.id, destinationLocationId: L1.id, ...b } })).status, 400, JSON.stringify(b));
      ok('M55', 'manipulación de cantidades (formatos, objetos, booleanos, hexadecimal, infinito): 400');
    }

    // ================================================================ 56-59 Idempotencia, reintentos y rollback
    {
      const key = K();
      const first = await receipt(U.operador, I1, L1, '2', key);
      const conflict = await receipt(U.operador, I1, L1, '3', key);
      assert.equal(conflict.status, 409); assert.equal(conflict.json.code, 'IDEMPOTENCY_CONFLICT');
      ok('M56', 'clave idempotente reutilizada con otro contenido: 409 IDEMPOTENCY_CONFLICT');
      // "Timeout": el servidor confirmó pero el cliente perdió la respuesta; el reintento con la misma clave recupera el original.
      const retry = await receipt(U.operador, I1, L1, '2', key);
      assert.equal(retry.status, 200); assert.equal(retry.json.movement.folio, first.json.movement.folio);
      assert.equal((await receipt(U.operador, I1, L1, '2')).status, 201, 'sin clave nueva no hay duplicado; con clave nueva es otra operación');
      assert.equal((await api(U.operador, R.receipts, 'POST', { body: { itemId: I1.id, destinationLocationId: L1.id, quantity: '1' } })).status, 400, 'sin clave se rechaza');
      ok('M57', 'timeout y reintento (pérdida de conexión, otra pestaña con la misma operación): se recupera el resultado original');
      const tk = K(); const triple = await Promise.all([1, 2, 3].map(() => receipt(U.operador, I1, L1, '1', tk)));
      assert.equal(new Set(triple.map(r => r.json.movement.folio)).size, 1);
      ok('M58', 'doble y triple clic simultáneos: una sola entrada');
      // Fallo intermedio: el movimiento ya se insertó y la custodia falla (folio duplicado) → rollback total.
      const custody = require('../repositories/warehouse-custody.repository.ts');
      const existing = await db.inventoryCustody.findFirst({ where: { itemId: I2.id }, select: { folio: true } });
      const movesBefore = await movCount(I1); const balBefore = await bal(I1, L1);
      await assert.rejects(custody.createOperationalHandoff({ movementFolio: `QA-${randomUUID()}`, custodyFolio: existing.folio, itemId: I1.id, quantity: new Prisma.Decimal(1),
        unit: 'PZ', originLocationId: L1.id, warehouseAreaId: warehouseArea.id, productionAreaId: productionArea.id, occurredAt: new Date(), actorId: U.operador }));
      assert.equal(await movCount(I1), movesBefore); assert.equal(await bal(I1, L1), balBefore);
      ok('M59', 'fallo intermedio: rollback completo, sin movimiento huérfano ni saldo alterado');
    }

    // ================================================================ 60-65 Reconciliación, reportes, historial, limpieza
    {
      const fixtureCodes = ids.items.length;
      const inv = await db.$queryRawUnsafe(`
        WITH f AS (SELECT "itemId", "destinationLocationId" loc, "quantity" q FROM "InventoryMovement" WHERE "destinationLocationId" IS NOT NULL
                   UNION ALL SELECT "itemId", "originLocationId", -"quantity" FROM "InventoryMovement" WHERE "originLocationId" IS NOT NULL)
        SELECT COUNT(*)::int AS negatives FROM (SELECT 1 FROM f WHERE "itemId" = ANY($1) GROUP BY "itemId", loc HAVING SUM(q) < 0) x`, ids.items);
      assert.equal(inv[0].negatives, 0);
      const custodyInv = await db.$queryRawUnsafe(`
        SELECT i."code",
          COALESCE((SELECT SUM("quantity") FROM "InventoryMovement" WHERE "itemId" = i."id" AND "type" = 'OPERATIONAL_HANDOFF'),0)
          - COALESCE((SELECT SUM("quantity") FROM "InventoryMovement" WHERE "itemId" = i."id" AND "type" = 'OPERATIONAL_RETURN'),0)
          - COALESCE((SELECT SUM(e."quantity") FROM "InventoryCustodyEvent" e JOIN "InventoryCustody" c ON c."id" = e."custodyId" WHERE c."itemId" = i."id" AND e."type" = 'CONSUMED'),0)
          - COALESCE((SELECT SUM("quantity") FROM "InventoryCustody" WHERE "itemId" = i."id" AND "closedAt" IS NULL AND "status" <> 'CLOSED'),0) AS diff
          FROM "InventoryItem" i WHERE i."id" = ANY($1)`, ids.items);
      for (const r of custodyInv) assert.equal(String(r.diff), '0', `custodia descuadrada ${r.code}`);
      const recon = await api(U.auditor, R.recon, 'GET');
      assert.equal(recon.status, 200);
      for (const f of recon.json.findings) assert.ok(!JSON.stringify(f.sample).includes(marker), `la reconciliación señala un fixture: ${f.check}`);
      ok('M60', 'reconciliación (solo lectura): sin negativos, custodias cuadradas y ningún hallazgo sobre los datos de prueba');
      const api2 = await api(U.consulta, R.inventory, 'GET');
      for (const it of [I1, I2]) {
        const row = api2.json.inventory.find(x => x.id === it.id);
        const sum = (await db.$queryRawUnsafe(`SELECT (COALESCE(SUM(CASE WHEN "destinationLocationId" IS NOT NULL THEN "quantity" END),0) - COALESCE(SUM(CASE WHEN "originLocationId" IS NOT NULL THEN "quantity" END),0))::text s FROM "InventoryMovement" WHERE "itemId" = $1`, it.id))[0].s;
        assert.equal(row.quantity, Number(sum), `existencia de ${it.code} = suma de movimientos`);
      }
      ok('M61', `consistencia tras pruebas concurrentes: existencia mostrada = suma del libro mayor (${fixtureCodes} artículos de prueba)`);

      // Volumen para reportes: 2,500 movimientos sintéticos (saldo inicial) en un artículo dedicado.
      const N = 2500; const base = Date.now() - N * 1000;
      await db.inventoryMovement.createMany({ data: Array.from({ length: N }, (_, i) => ({
        folio: `${marker.slice(0, 18)}-V${String(i).padStart(5, '0')}`, itemId: IB.id, type: 'INITIAL_BALANCE', quantity: new Prisma.Decimal(1), unit: 'PZ',
        destinationLocationId: L3.id, referenceType: 'QA', referenceNumber: marker, occurredAt: new Date(base + Math.floor(i / 3) * 1000), actorId: U.operador })) });
      const csv = await api(U.consulta, R.report, 'GET', { query: `?itemId=${IB.id}&format=csv` });
      assert.equal(csv.status, 200); const csvRows = csv.text.replace(/^﻿/, '').split('\r\n').slice(1);
      assert.equal(csvRows.length, N); assert.equal(csv.headers.get('X-Total-Rows'), String(N));
      const kcsv = await api(U.consulta, R.kardex, 'GET', { query: `?itemId=${IB.id}&format=csv` });
      const krows = kcsv.text.replace(/^﻿/, '').split('\r\n').slice(1);
      assert.equal(krows.length, N); assert.match(krows[N - 1], new RegExp(`,${N}(\\.000)?,PZ,`));
      ok('M62', `exportación completa: ${N} movimientos en CSV de reporte y Kardex (sin límite oculto; saldo final ${N})`);
      const seen = new Set(); let cursor = ''; let pages = 0;
      for (;;) {
        const page = await api(U.consulta, R.report, 'GET', { query: `?itemId=${IB.id}&limit=97${cursor ? `&cursor=${cursor}` : ''}` });
        pages += 1; assert.ok(page.json.total >= N);
        for (const r of page.json.rows) { assert.ok(!seen.has(r.id), 'sin duplicados entre páginas'); seen.add(r.id); }
        if (!page.json.nextCursor) break; cursor = page.json.nextCursor;
        if (pages === 3) await receipt(U.operador, IB, L3, '1'); // un movimiento nuevo durante la paginación no desplaza páginas
      }
      assert.equal(seen.size, N);
      ok('M63', `filtros y paginación por cursor: ${pages} páginas, ${N} registros, sin duplicados ni omisiones aunque entren movimientos nuevos`);
      const anyMov = await db.inventoryMovement.findFirst({ where: { itemId: I1.id } });
      await assert.rejects(db.$executeRawUnsafe(`UPDATE "InventoryMovement" SET "quantity" = 999 WHERE "id" = $1`, anyMov.id), /YF_APPEND_ONLY/);
      await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "InventoryMovement" WHERE "id" = $1`, anyMov.id), /YF_APPEND_ONLY/);
      await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "InventoryMovement" ("id","folio","itemId","type","quantity","unit","originLocationId","destinationLocationId","occurredAt","actorId") VALUES ($1,$1,$2,'EXTERNAL_RECEIPT',-1,'PZ',NULL,$3,now(),$4)`, `${marker}-NEG`, I1.id, L1.id, U.operador), /InventoryMovement_quantity_positive/);
      await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "InventoryMovement" ("id","folio","itemId","type","quantity","unit","originLocationId","destinationLocationId","occurredAt","actorId") VALUES ($1,$1,$2,'INTERNAL_TRANSFER',1,'PZ',$3,$3,now(),$4)`, `${marker}-SAME`, I1.id, L1.id, U.operador), /InventoryMovement_shape_by_type/);
      assert.equal((await db.inventoryMovement.findUnique({ where: { id: anyMov.id } })).quantity.toString(), anyMov.quantity.toString());
      const kx = await api(U.consulta, R.kardex, 'GET', { query: `?itemId=${I1.id}` });
      assert.ok(kx.json.rows.some(r => r.reversedBy), 'el Kardex muestra el movimiento revertido y su reverso');
      ok('M64', 'historial preservado: el libro mayor rechaza UPDATE/DELETE y movimientos inválidos en la base de datos; Kardex muestra reversos');
      const dash = await api(U.consulta, R.dashboard, 'GET');
      assert.equal(dash.status, 200); assert.ok(Array.isArray(dash.json.stockByUnit)); assert.ok(dash.json.stockByUnit.every(r => typeof r.unit === 'string'));
      ok('M66', 'tablero: indicadores deterministas por unidad (sin sumar unidades distintas)');
    }
  } finally {
    // ================================================================ limpieza controlada de datos sintéticos
    try {
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SELECT set_config('yellowflex.fixture_cleanup', $1, true)", marker);
        const items = ids.items;
        const counts = await tx.warehouseCount.findMany({ where: { itemId: { in: items } }, select: { id: true } });
        const discs = await tx.warehouseDiscrepancy.findMany({ where: { countId: { in: counts.map(c => c.id) } }, select: { id: true } });
        const dIds = discs.map(d => d.id);
        await tx.warehouseDiscrepancyEvent.deleteMany({ where: { discrepancyId: { in: dIds } } });
        await tx.warehouseDiscrepancyRecount.deleteMany({ where: { discrepancyId: { in: dIds } } });
        await tx.warehouseDiscrepancy.deleteMany({ where: { id: { in: dIds } } });
        await tx.warehouseCount.deleteMany({ where: { itemId: { in: items } } });
        const cus = await tx.inventoryCustody.findMany({ where: { itemId: { in: items } }, select: { id: true } });
        await tx.inventoryCustodyEvent.deleteMany({ where: { custodyId: { in: cus.map(c => c.id) } } });
        await tx.inventoryCustodyOperation.deleteMany({ where: { custodyId: { in: cus.map(c => c.id) } } });
        await tx.inventoryCustody.deleteMany({ where: { itemId: { in: items } } });
        await tx.inventoryMovement.deleteMany({ where: { itemId: { in: items } } });
        await tx.warehouseStockOperation.deleteMany({ where: { actorId: { in: ids.users } } });
        await tx.inventoryItem.deleteMany({ where: { id: { in: items } } });
        if (ids.warehouse) { await tx.warehouseLocation.deleteMany({ where: { warehouseId: ids.warehouse } }); await tx.warehouse.delete({ where: { id: ids.warehouse } }); }
        await tx.corporatePermissionAudit.deleteMany({ where: { OR: [{ actorId: { in: ids.users } }, { targetId: { in: ids.users } }] } });
        await tx.warehousePermission.deleteMany({ where: { userId: { in: ids.users } } });
        await tx.corporateModulePermission.deleteMany({ where: { userId: { in: ids.users } } });
        await tx.userRole.deleteMany({ where: { userId: { in: ids.users } } });
        await tx.user.deleteMany({ where: { id: { in: ids.users } } });
      }, { timeout: 120000 });
      const residue = await db.$queryRawUnsafe(`SELECT
        (SELECT COUNT(*) FROM "User" WHERE "name" LIKE $1)::int AS users, (SELECT COUNT(*) FROM "InventoryItem" WHERE "code" LIKE $1)::int AS items,
        (SELECT COUNT(*) FROM "InventoryMovement" WHERE "referenceNumber" LIKE $1 OR "notes" LIKE $1)::int AS movements,
        (SELECT COUNT(*) FROM "Warehouse" WHERE "name" LIKE $1)::int AS warehouses`, `${marker}%`);
      t.diagnostic(`LIMPIEZA residuo=${JSON.stringify(residue[0])}`);
      assert.deepEqual(residue[0], { users: 0, items: 0, movements: 0, warehouses: 0 });
      ok('M65', 'limpieza de datos sintéticos sin residuos (eliminación declarada explícitamente en la sesión)');
      t.diagnostic(`QA YF-003 MATRIZ: escenarios=${results.length} [${results.join(',')}]`);
    } finally {
      setSessionUser(null);
      await db.$disconnect();
    }
  }
});
