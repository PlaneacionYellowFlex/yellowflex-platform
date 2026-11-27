/* eslint-disable @typescript-eslint/no-require-imports */
// YF-003 · Informe de impacto de permisos de Warehouse (SOLO LECTURA). Compara, por usuario activo, la política anterior
// (atajos por rol ADMIN/DIRECCIÓN/PRODUCCIÓN) contra la política nueva (concesiones explícitas). No modifica nada.
// Uso: node --require ./tests/helpers/server-only-register.cjs --import tsx scripts/warehouse-permission-impact.cjs
const { configureIsolatedConnection, assertIsolatedIdentity } = require('../tests/helpers/isolated-postgres.cjs');

const CAPS = ['view', 'operate', 'investigate', 'approve', 'audit', 'production', 'productionView'];
const LABEL = { view: 'consultar', operate: 'operar', investigate: 'investigar', approve: 'aprobar ajustes', audit: 'auditar', production: 'operar Producción', productionView: 'consultar Producción' };

function previousPolicy(roles, grants, legacy) {
  const admin = roles.includes('ADMIN');
  const prodRole = roles.some(r => ['ADMIN', 'DIRECCION', 'PRODUCCION'].includes(r));
  const cp = a => grants.has(a);
  return {
    view: admin || (cp('view') && legacy?.canViewInventory === true),
    operate: admin || (cp('view') && cp('operate') && legacy?.canRegisterMovement === true),
    investigate: admin || (cp('view') && cp('operate') && legacy?.canManageWarehouse === true),
    // Antes, la aprobación de ajustes por discrepancia aceptaba ADMIN o DIRECCIÓN por rol.
    approve: admin || roles.includes('DIRECCION') || (cp('view') && cp('approve') && legacy?.canApproveWarehouseAdjustments === true),
    audit: admin,
    production: prodRole && (admin || (cp('view') && cp('operate'))),
    productionView: prodRole && (admin || cp('view')),
  };
}

(async () => {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  globalThis.prisma = db;
  try {
    await assertIsolatedIdentity(db);
    const { getWarehouseCapabilities } = require('../lib/warehouse/capabilities.ts');
    const users = await db.user.findMany({
      where: { active: true, OR: [{ roles: { some: { role: { in: ['ADMIN', 'DIRECCION', 'PRODUCCION'] } } } }, { warehousePermission: { isNot: null } },
        { modulePermissions: { some: { moduleKey: { in: ['warehouse', 'c-panel'] }, granted: true } } }] },
      select: { id: true, name: true, roles: { select: { role: true } }, warehousePermission: true,
        modulePermissions: { where: { moduleKey: 'warehouse', granted: true }, select: { actionKey: true } } },
      orderBy: { name: 'asc' },
    });
    const rows = [];
    for (const u of users) {
      const roles = u.roles.map(r => r.role);
      const before = previousPolicy(roles, new Set(u.modulePermissions.map(p => p.actionKey)), u.warehousePermission);
      const after = await getWarehouseCapabilities(u.id, db);
      const lost = CAPS.filter(c => before[c] && !after[c]).map(c => LABEL[c]);
      const gained = CAPS.filter(c => !before[c] && after[c]).map(c => LABEL[c]);
      rows.push({ usuario: u.name, roles: roles.join('+'), pierde: lost, gana: gained, conserva: CAPS.filter(c => before[c] && after[c]).map(c => LABEL[c]) });
    }
    await assertIsolatedIdentity(db);
    const summary = { usuariosRevisados: rows.length, conCambios: rows.filter(r => r.pierde.length || r.gana.length).length,
      quePierdenAprobacion: rows.filter(r => r.pierde.includes('aprobar ajustes')).length, queGananAlgo: rows.filter(r => r.gana.length).length };
    console.log(JSON.stringify({ soloLectura: true, summary, cambios: rows.filter(r => r.pierde.length || r.gana.length), sinCambios: rows.filter(r => !r.pierde.length && !r.gana.length).map(r => r.usuario) }, null, 2));
  } finally { await db.$disconnect(); }
})().catch(e => { console.error('DETENIDO: ' + String(e && e.message || e).replace(/postgres(ql)?:\/\/\S+/g, '<url>')); process.exitCode = 1; });
