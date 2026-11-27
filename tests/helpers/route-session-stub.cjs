/* eslint-disable @typescript-eslint/no-require-imports */
// Ver route-session.cjs. Reexporta el módulo real de autenticación corporativa y reemplaza solo la lectura de la cookie.
const real = require('../../lib/auth/corporate-auth.ts');

async function getCurrentCorporateUser() {
  const id = globalThis.__yfRouteSessionUserId;
  if (!id) return null;
  const db = globalThis.prisma;
  const user = await db.user.findUnique({ where: { id }, include: { roles: true } });
  if (!user || !user.active) return null;
  return { id: user.id, name: user.name, email: user.email, roles: user.roles.map(r => r.role), employee: null, passwordMustChange: false };
}
async function requireCorporatePasswordChangeUser() {
  const user = await getCurrentCorporateUser();
  if (!user) throw new real.CorporateAuthenticationRequired();
  return user;
}
async function requireCorporateUser() { return requireCorporatePasswordChangeUser(); }

module.exports = {
  CorporateAuthenticationRequired: real.CorporateAuthenticationRequired,
  CorporateAuthorizationRequired: real.CorporateAuthorizationRequired,
  CorporateLoginError: real.CorporateLoginError,
  getCurrentCorporateUser, requireCorporatePasswordChangeUser, requireCorporateUser,
  requireCorporateRole: real.requireCorporateRole,
};
