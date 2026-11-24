import "server-only";

import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";
import type { CpanelAction, CpanelModule } from "@/lib/cpanel/permission-catalog";

/** La delegación se concede solo a RH por un ADMIN mediante c-panel/manage. */
export async function requireCpanelAdministrator() {
  const actor = await requireCorporateUser();
  if (actor.roles.includes("ADMIN")) return { actor, scope: "admin" as const };
  if (!actor.roles.includes("RH")) throw new CorporateAuthorizationRequired("Acceso restringido");
  const delegation = await db.corporateModulePermission.findUnique({
    where: { userId_moduleKey_actionKey: { userId: actor.id, moduleKey: "c-panel", actionKey: "manage" } },
    select: { granted: true },
  });
  if (!delegation?.granted) throw new CorporateAuthorizationRequired("RH no tiene delegada la administración de permisos");
  return { actor, scope: "rh" as const };
}

export function rhCanChange(moduleKey: CpanelModule, actionKey: CpanelAction) {
  return actionKey === "view" || actionKey === "operate"
    ? moduleKey !== "c-panel" && moduleKey !== "settings"
    : false;
}
