import "server-only";

import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";
import { type CpanelAction, type CpanelModule } from "@/lib/cpanel/permission-catalog";

/**
 * Nueva política central. No modifica ni reemplaza las autorizaciones heredadas.
 * Se activa en una API solamente cuando esa API invoca requireCpanelPermission.
 * Una concesión explícita es necesaria: no hay acceso implícito por rol.
 */
export async function hasCpanelPermission(
  userId: string,
  moduleKey: CpanelModule,
  actionKey: CpanelAction,
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { active: true },
  });
  if (!user?.active) return false;

  const permission = await db.corporateModulePermission.findUnique({
    where: { userId_moduleKey_actionKey: { userId, moduleKey, actionKey } },
    select: { granted: true },
  });
  return permission?.granted === true;
}

export async function requireCpanelPermission(
  moduleKey: CpanelModule,
  actionKey: CpanelAction,
) {
  const user = await requireCorporateUser();
  if (!(await hasCpanelPermission(user.id, moduleKey, actionKey))) {
    throw new CorporateAuthorizationRequired("Acceso restringido");
  }
  return user;
}
