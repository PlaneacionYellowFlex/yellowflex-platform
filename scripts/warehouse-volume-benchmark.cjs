/* eslint-disable @typescript-eslint/no-require-imports */
// YF-003 · Prueba de volumen y concurrencia de Almacén. SOLO PostgreSQL aislado (127.0.0.1:55432/yellowflex_restore_test).
// Crea datos SINTÉTICOS con marcador QA-WH-VOL-<uuid>, mide tiempos (p50/p95/p99), memoria e integridad final, y elimina todo
// al terminar (eliminación declarada expresamente en la sesión). Los volúmenes son escenarios de estrés, no datos de YellowFlex.
// Uso: node --require ./tests/helpers/server-only-register.cjs --import tsx scripts/warehouse-volume-benchmark.cjs [articulos] [movimientos]
const { randomUUID } = require('node:crypto');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('../tests/helpers/isolated-postgres.cjs');

const ITEMS = Number(process.argv[2] ?? 10000);
const MOVEMENTS = Number(process.argv[3] ?? 100000);
const LOCATIONS = 50;
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null; };
const stats = arr => ({ n: arr.length, p50: pct(arr, 50), p95: pct(arr, 95), p99: pct(arr, 99), max: Math.max(...arr) });
async function time(fn) { const t = process.hrtime.bigint(); const r = await fn(); return { ms: Number(process.hrtime.bigint() - t) / 1e6, r }; }
async function sample(n, fn) { const out = []; for (let i = 0; i < n; i += 1) out.push((await time(fn)).ms); return stats(out.map(v => Math.round(v * 10) / 10)); }

(async () => {
  const url = configureIsolatedConnection();
  const { PrismaClient, Prisma } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  globalThis.prisma = db;
  const marker = `QA-WH-VOL-${randomUUID().slice(0, 8)}`;
  const report = { soloAislado: true, marker, escenario: { articulos: ITEMS, movimientos: MOVEMENTS, ubicaciones: LOCATIONS }, mediciones: {}, concurrencia: {}, integridad: {}, limpieza: null };
  let userId = null; let warehouseId = null;
  try {
    await assertIsolatedIdentity(db);
    const reporting = require('../repositories/warehouse-reporting.repository.ts');
    const movements = require('../repositories/warehouse-movements.repository.ts');
    const ops = require('../repositories/warehouse-operations.repository.ts');
    const { getWarehouseStockBalance } = require('../repositories/warehouse-stock-lock.ts');

    // ---------- carga sintética (SQL por lotes)
    const load = await time(async () => {
      const u = await db.user.create({ data: { name: `${marker} actor`, email: `${marker.toLowerCase()}@example.invalid`, passwordMustChange: false } }); userId = u.id;
      const w = await db.warehouse.create({ data: { code: marker, name: `${marker} almacén` } }); warehouseId = w.id;
      await db.$executeRawUnsafe(`INSERT INTO "WarehouseLocation" ("id","warehouseId","code","name","updatedAt")
        SELECT $1 || '-L' || g, $2, 'V-' || g, $1 || ' ubicación ' || g, now() FROM generate_series(1, ${LOCATIONS}) g`, marker, warehouseId);
      await db.$executeRawUnsafe(`INSERT INTO "InventoryItem" ("id","code","description","baseUnit","updatedAt")
        SELECT $1 || '-I' || g, $1 || '-' || lpad(g::text, 6, '0'), 'Artículo sintético ' || g, CASE WHEN g % 3 = 0 THEN 'KG' ELSE 'PZ' END, now() FROM generate_series(1, ${ITEMS}) g`, marker);
      // Saldo inicial de 1,000 por artículo en V-1 y el resto del volumen como transferencias de 1 unidad hacia V-2..V-50.
      await db.$executeRawUnsafe(`INSERT INTO "InventoryMovement" ("id","folio","itemId","type","quantity","unit","destinationLocationId","referenceType","referenceNumber","occurredAt","actorId")
        SELECT $1 || '-S' || g, $1 || '-S' || g, $1 || '-I' || g, 'INITIAL_BALANCE', 1000, CASE WHEN g % 3 = 0 THEN 'KG' ELSE 'PZ' END, $1 || '-L1', 'QA', $1,
               now() - interval '400 days', $2 FROM generate_series(1, ${ITEMS}) g`, marker, userId);
      const rest = Math.max(MOVEMENTS - ITEMS, 0); const chunk = 100000;
      for (let off = 0; off < rest; off += chunk) {
        const n = Math.min(chunk, rest - off);
        await db.$executeRawUnsafe(`INSERT INTO "InventoryMovement" ("id","folio","itemId","type","quantity","unit","originLocationId","destinationLocationId","referenceType","referenceNumber","occurredAt","actorId")
          SELECT $1 || '-T' || g, $1 || '-T' || g, $1 || '-I' || (1 + (g % ${ITEMS})), 'INTERNAL_TRANSFER', 1, CASE WHEN (1 + (g % ${ITEMS})) % 3 = 0 THEN 'KG' ELSE 'PZ' END,
                 $1 || '-L1', $1 || '-L' || (2 + (g % ${LOCATIONS - 1})), 'QA', $1, now() - ((g % 400) || ' days')::interval, $2
            FROM generate_series(${off + 1}, ${off + n}) g`, marker, userId);
      }
      // Artículo "pesado": 20,000 movimientos adicionales para medir Kardex y exportación de un solo código.
      await db.$executeRawUnsafe(`INSERT INTO "InventoryMovement" ("id","folio","itemId","type","quantity","unit","destinationLocationId","referenceType","referenceNumber","occurredAt","actorId")
        SELECT $1 || '-H' || g, $1 || '-H' || g, $1 || '-I1', 'INITIAL_BALANCE', 1, 'PZ', $1 || '-L1', 'QA', $1, now() - ((g % 400) || ' days')::interval, $2
          FROM generate_series(1, 20000) g`, marker, userId);
      await db.$executeRawUnsafe('ANALYZE "InventoryMovement"');
    });
    report.mediciones.cargaSinteticaMs = Math.round(load.ms);
    const total = await db.inventoryMovement.count({ where: { referenceNumber: marker } });
    report.escenario.movimientosCreados = total;
    const heavyItem = `${marker}-I1`;
    const L1 = `${marker}-L1`;

    // ---------- consultas de solo lectura (todo el inventario de la base aislada, incluidos los datos sintéticos)
    // V2: consulta habitual de existencias (existencia materializada) y, como referencia "antes", la agregación del libro mayor.
    const inv = require('../repositories/warehouse.repository.ts');
    report.mediciones.antesAgregacionLibroMayor = await sample(5, () => db.$queryRawUnsafe(`SELECT "itemId", loc, SUM(q) q FROM (
        SELECT "itemId", "destinationLocationId" loc, "quantity" q FROM "InventoryMovement" WHERE "destinationLocationId" IS NOT NULL
        UNION ALL SELECT "itemId", "originLocationId", -"quantity" FROM "InventoryMovement" WHERE "originLocationId" IS NOT NULL) f GROUP BY "itemId", loc HAVING SUM(q) <> 0`));
    report.mediciones.inventarioTotalesPorArticulo = await sample(30, () => inv.getInventoryTotals());
    report.mediciones.existenciasPagina200 = await sample(30, () => reporting.stockPage({}, null, 200, db));
    report.mediciones.existenciasBusquedaCodigo = await sample(30, () => reporting.stockPage({ search: `${marker}-000123` }, null, 200, db));
    report.mediciones.existenciasPorUbicacionPagina = await sample(30, () => reporting.stockPage({ locationId: `${marker}-L7` }, null, 200, db));
    report.mediciones.existenciasArticulo = await sample(30, () => reporting.stockPage({ itemId: heavyItem }, null, 200, db));
    report.mediciones.saldoArticuloUbicacion = await sample(30, () => inv.getInventoryBalancesByItem(heavyItem));
    report.mediciones.existenciasDetalleCompletoSinPaginar = await sample(5, () => reporting.stockByLocation(db));
    report.mediciones.diferenciasR8 = await sample(3, () => db.$queryRawUnsafe('SELECT COUNT(*)::int n FROM "yf_stock_balance_differences"()'));
    const [r8] = await db.$queryRawUnsafe('SELECT COUNT(*)::int n FROM "yf_stock_balance_differences"()');
    report.integridad.diferenciasExistenciaMaterializada = r8.n;
    // Planes de ejecución reales (EXPLAIN ANALYZE) de la consulta habitual y de la agregación anterior.
    const plan = async sqlText => (await db.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sqlText}`)).map(r => r['QUERY PLAN']);
    report.planes = {
      existenciasPagina200: await plan(`SELECT b."itemId", i."code", b."locationId", b."quantity" FROM "InventoryStockBalance" b JOIN "InventoryItem" i ON i."id" = b."itemId"
        JOIN "WarehouseLocation" l ON l."id" = b."locationId" WHERE b."quantity" <> 0 ORDER BY i."code", b."locationId" LIMIT 201`),
      totalesPorArticulo: await plan(`SELECT "itemId", SUM("quantity"), COUNT(*) FROM "InventoryStockBalance" WHERE "quantity" <> 0 GROUP BY "itemId"`),
      antesAgregacionLibroMayor: await plan(`SELECT "itemId", loc, SUM(q) FROM (SELECT "itemId", "destinationLocationId" loc, "quantity" q FROM "InventoryMovement" WHERE "destinationLocationId" IS NOT NULL
        UNION ALL SELECT "itemId", "originLocationId", -"quantity" FROM "InventoryMovement" WHERE "originLocationId" IS NOT NULL) f GROUP BY "itemId", loc HAVING SUM(q) <> 0`),
    };
    report.mediciones.tablero = await sample(5, () => reporting.dashboardIndicators(db));
    report.mediciones.reconciliacion = await sample(3, () => reporting.reconcile(db));
    report.mediciones.busquedaPagina100 = await sample(30, () => reporting.searchMovements({ reference: null, itemId: null }, null, 100, db));
    report.mediciones.busquedaFiltradaArticulo = await sample(30, () => reporting.searchMovements({ itemId: heavyItem }, null, 100, db));
    report.mediciones.conteoTotalFiltro = await sample(10, () => reporting.countMovements({ itemId: heavyItem }, db));
    report.mediciones.kardexArticuloPagina200 = await sample(20, () => reporting.kardex(heavyItem, null, null, 200, db));
    report.mediciones.saldoBajoBloqueo = await sample(30, () => db.$transaction(tx => getWarehouseStockBalance(tx, heavyItem, L1)));
    // Exportación completa por bloques de un artículo (todas sus filas).
    const exp = await time(async () => {
      let cursor = null; let n = 0;
      for (;;) { const page = await reporting.searchMovements({ itemId: heavyItem }, cursor, 1000, db); n += page.rows.length; if (!page.nextCursor) break; cursor = reporting.decodeCursor(page.nextCursor); }
      return n;
    });
    report.mediciones.exportacionArticuloCompleta = { filas: exp.r, ms: Math.round(exp.ms) };

    // ---------- concurrencia: 40 salidas simultáneas de 600 sobre la misma existencia + 40 transferencias en sentidos opuestos
    const before = (await getWarehouseStockBalance(db, heavyItem, L1)).toString();
    const issues = await time(() => Promise.allSettled(Array.from({ length: 40 }, () => ops.createExternalIssueOnce({
      folio: `${marker}-X-${randomUUID().slice(0, 12)}`, itemId: heavyItem, originLocationId: L1, quantity: new Prisma.Decimal(600), reason: 'Prueba de concurrencia sintética',
      destination: 'QA', referenceNumber: marker, actorId: userId, occurredAt: new Date(),
    }, { idempotencyKey: randomUUID(), payload: { n: randomUUID() } }, m => ({ folio: m.folio })))));
    const okIssues = issues.r.filter(r => r.status === 'fulfilled').length;
    const L2 = `${marker}-L2`;
    const opp = await time(() => Promise.allSettled(Array.from({ length: 40 }, (_, i) => movements.createInternalTransfer((() => {
      const from = i % 2 ? L1 : L2; const to = i % 2 ? L2 : L1; const key = randomUUID();
      const payload = { itemId: heavyItem, originLocationId: from, destinationLocationId: to, quantity: '1.000', referenceType: null, referenceNumber: null, notes: null };
      const { payloadHash } = require('../lib/warehouse-idempotency.ts');
      return { folio: `${marker}-Y-${randomUUID().slice(0, 12)}`, itemId: heavyItem, quantity: new Prisma.Decimal(1), unit: 'PZ', originLocationId: from, originLocationCode: 'V', destinationLocationId: to,
        occurredAt: new Date(), actorId: userId, operationKey: `INTERNAL_TRANSFER:${userId}:${key}`, operationPayloadHash: payloadHash({ kind: 'INTERNAL_TRANSFER', actorId: userId, payload }) };
    })()))));
    const after = (await getWarehouseStockBalance(db, heavyItem, L1)).toString();
    report.concurrencia = {
      salidasSimultaneas: { solicitudes: 40, aceptadas: okIssues, rechazadasPorExistencia: 40 - okIssues, ms: Math.round(issues.ms), existenciaAntes: before },
      transferenciasOpuestas: { solicitudes: 40, aceptadas: opp.r.filter(r => r.status === 'fulfilled').length, ms: Math.round(opp.ms),
        errores: [...new Set(opp.r.filter(r => r.status === 'rejected').map(r => String(r.reason?.message ?? r.reason).slice(0, 80)))] },
      existenciaDespues: after,
    };
    // ---------- integridad final de los datos sintéticos
    const [neg] = await db.$queryRawUnsafe(`WITH f AS (
        SELECT "itemId", "destinationLocationId" loc, "quantity" q FROM "InventoryMovement" WHERE "referenceNumber" = $1 AND "destinationLocationId" IS NOT NULL
        UNION ALL SELECT "itemId", "originLocationId", -"quantity" FROM "InventoryMovement" WHERE "referenceNumber" = $1 AND "originLocationId" IS NOT NULL)
      SELECT COUNT(*)::int AS negativos FROM (SELECT 1 FROM f GROUP BY "itemId", loc HAVING SUM(q) < 0) x`, marker);
    const accepted = opp.r.map((r, i) => (r.status === 'fulfilled' ? (i % 2 ? -1 : 1) : 0)).reduce((a, b) => a + b, 0); // +1: V-2→V-1, −1: V-1→V-2
    const expected = new Prisma.Decimal(before).minus(new Prisma.Decimal(600).times(okIssues)).plus(accepted);
    report.integridad = { ...report.integridad, saldosNegativos: neg.negativos, existenciaV1Esperada: expected.toString(), existenciaV1Real: after,
      cuadra: expected.equals(new Prisma.Decimal(after)), salidasNoExcedenExistencia: okIssues <= Math.floor(Number(before) / 600) + 1 };
    report.memoriaMB = Math.round(process.memoryUsage().rss / 1048576);
  } finally {
    const t = await time(async () => db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SELECT set_config('yellowflex.fixture_cleanup', $1, true)", marker);
      await tx.$executeRawUnsafe(`DELETE FROM "InventoryMovement" WHERE "referenceNumber" = $1 OR "folio" LIKE $2`, marker, `${marker}%`);
      await tx.$executeRawUnsafe(`DELETE FROM "WarehouseStockOperation" WHERE "actorId" = $1`, userId ?? '');
      await tx.$executeRawUnsafe(`DELETE FROM "InventoryItem" WHERE "id" LIKE $1`, `${marker}-I%`);
      await tx.$executeRawUnsafe(`DELETE FROM "WarehouseLocation" WHERE "warehouseId" = $1`, warehouseId ?? '');
      await tx.$executeRawUnsafe(`DELETE FROM "Warehouse" WHERE "id" = $1`, warehouseId ?? '');
      await tx.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = $1`, userId ?? '');
    }, { timeout: 600000 }));
    const [left] = await db.$queryRawUnsafe(`SELECT (SELECT COUNT(*) FROM "InventoryMovement" WHERE "referenceNumber" = $1 OR "folio" LIKE $2)::int AS movimientos,
      (SELECT COUNT(*) FROM "InventoryItem" WHERE "id" LIKE $3)::int AS articulos, (SELECT COUNT(*) FROM "User" WHERE "name" LIKE $2)::int AS usuarios`, marker, `${marker}%`, `${marker}-I%`);
    report.limpieza = { ms: Math.round(t.ms), residuo: left };
    console.log(JSON.stringify(report, null, 2));
    await db.$disconnect();
  }
})().catch(e => { console.error('DETENIDO: ' + String(e && e.message || e).replace(/postgres(ql)?:\/\/\S+/g, '<url>')); process.exitCode = 1; });
