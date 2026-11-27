/* eslint-disable @typescript-eslint/no-require-imports */
// YF-003 V2 · Informe de privilegios efectivos del usuario de la aplicación sobre el libro mayor y los historiales (SOLO LECTURA).
// Responde: ¿puede el usuario de la aplicación evitar los disparadores append-only por otra vía (desactivar disparadores,
// session_replication_role, ser dueño de las tablas, TRUNCATE, superusuario)? No cambia nada; emite hallazgos y recomendaciones.
// Uso: node --require ./tests/helpers/server-only-register.cjs --import tsx scripts/warehouse-db-privileges.cjs [--salida archivo.json]
const { writeFileSync } = require('node:fs');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('../tests/helpers/isolated-postgres.cjs');

const TABLES = ['InventoryMovement', 'InventoryCustodyEvent', 'InventoryCustodyOperation', 'WarehouseStockOperation', 'WarehouseDiscrepancyEvent',
  'WarehouseCatalogAudit', 'WarehouseReconciliationException', 'InventoryStockBalance'];
const outIdx = process.argv.indexOf('--salida');
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : null;

(async () => {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await assertIsolatedIdentity(db);
    const [role] = await db.$queryRawUnsafe(`SELECT current_user::text AS usuario, r.rolsuper AS superusuario, r.rolbypassrls AS "omiteRLS", r.rolcreaterole AS "creaRoles",
        r.rolreplication AS replicacion FROM pg_roles r WHERE r.rolname = current_user`);
    const tables = await db.$queryRawUnsafe(`SELECT c.relname::text AS tabla, pg_get_userbyid(c.relowner)::text AS dueno, pg_has_role(current_user, c.relowner, 'MEMBER') AS "usuarioEsDuenoOMiembro",
        has_table_privilege(current_user, c.oid, 'UPDATE') AS "puedeUPDATE", has_table_privilege(current_user, c.oid, 'DELETE') AS "puedeDELETE",
        has_table_privilege(current_user, c.oid, 'TRUNCATE') AS "puedeTRUNCATE", has_table_privilege(current_user, c.oid, 'TRIGGER') AS "puedeTRIGGER",
        (SELECT json_agg(json_build_object('disparador', t.tgname::text, 'estado', t.tgenabled::text) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS disparadores
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relname = ANY($1) ORDER BY c.relname`, TABLES);
    const findings = [];
    if (role.superusuario) findings.push({ severidad: 'CRITICO', hallazgo: 'El usuario de la aplicación es SUPERUSUARIO: puede usar session_replication_role=replica y omitir cualquier disparador.' });
    for (const t of tables) {
      if (t.usuarioEsDuenoOMiembro) findings.push({ severidad: 'ALTO', tabla: t.tabla, hallazgo: 'El usuario de la aplicación es dueño de la tabla: puede ALTER TABLE ... DISABLE TRIGGER o eliminar los disparadores.' });
      const disabled = (t.disparadores ?? []).filter(d => d.estado === 'D');
      if (disabled.length) findings.push({ severidad: 'CRITICO', tabla: t.tabla, hallazgo: `Disparadores desactivados: ${disabled.map(d => d.disparador).join(', ')}` });
      if (t.tabla !== 'InventoryStockBalance' && !(t.disparadores ?? []).some(d => d.disparador.endsWith('_append_only'))) findings.push({ severidad: 'CRITICO', tabla: t.tabla, hallazgo: 'Falta el disparador append-only.' });
    }
    const report = {
      soloLectura: true, generado: new Date().toISOString(), rol: role, tablas: tables, hallazgos: findings,
      controlesVigentes: [
        'UPDATE y TRUNCATE rechazados siempre por disparador; DELETE solo de datos sintéticos QA-… en la base aislada 55432/yellowflex_restore_test.',
        'La variable de sesión por sí sola no basta: además exige base aislada, marcador QA válido y que el registro pertenezca a ese marcador.',
        'La existencia materializada solo la escribe el disparador del libro mayor o la reconstrucción controlada.',
      ],
      recomendaciones: [
        'Producción: la aplicación debe conectarse con un rol que NO sea dueño de las tablas ni superusuario (las migraciones con un rol dueño distinto).',
        'Producción: REVOKE UPDATE, DELETE, TRUNCATE ON los historiales FROM el rol de la aplicación (defensa adicional a los disparadores).',
        'Producción: REVOKE TRIGGER y no conceder pertenencia al rol dueño; vigilar ALTER TABLE ... DISABLE TRIGGER en la auditoría de PostgreSQL.',
        'Ejecutar este informe después de cada instalación; cualquier hallazgo CRITICO o ALTO se resuelve antes de liberar.',
      ],
    };
    if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ usuario: role.usuario, superusuario: role.superusuario, tablas: tables.length, hallazgos: findings.map(f => `${f.severidad} ${f.tabla ?? ''} ${f.hallazgo}`) }, null, 2));
  } finally { await db.$disconnect(); }
})().catch(e => { console.error('DETENIDO: ' + String(e && e.message || e).replace(/postgres(ql)?:\/\/\S+/g, '<url>')); process.exitCode = 1; });
