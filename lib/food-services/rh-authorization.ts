import "server-only";

import type { AuthenticatedUser } from "@/lib/access-control";
import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { hasModulePermission } from "@/lib/cpanel/module-access";

export async function hasFoodServicesRhAccess(user: AuthenticatedUser) {
  if (user.roles.includes("ADMIN")) return true;
  return user.roles.includes("RH") && hasModulePermission(user, "food-services", "manage");
}

export async function requireFoodServicesRhAccess() {
  const user = await requireCorporateUser();
  if (!(await hasFoodServicesRhAccess(user))) {
    throw new CorporateAuthorizationRequired("Acceso restringido");
  }
  return user;
}
