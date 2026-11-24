import "server-only";

import type { AuthenticatedUser } from "@/lib/access-control";
import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { hasCpanelPermission } from "@/lib/cpanel/authorization";
import type { CpanelAction, CpanelModule } from "@/lib/cpanel/permission-catalog";
import { db } from "@/lib/db";

/** ADMIN retains governance. Every other account needs view AND the requested action. */
export async function hasModulePermission(user: AuthenticatedUser, module: CpanelModule, action: CpanelAction = "view") {
  if (user.roles.includes("ADMIN")) return true;
  if (!(await hasCpanelPermission(user.id, module, "view"))) return false;
  return action === "view" || hasCpanelPermission(user.id, module, action);
}

export async function requireModulePermission(module: CpanelModule, action: CpanelAction = "view") {
  const user = await requireCorporateUser();
  if (!(await hasModulePermission(user, module, action))) {
    throw new CorporateAuthorizationRequired("Acceso restringido");
  }
  return user;
}

export async function requireRhPermission(action: CpanelAction = "view") {
  const user = await requireModulePermission("rrhh", action);
  if (!user.roles.some(role => role === "ADMIN" || role === "RH")) {
    throw new CorporateAuthorizationRequired("Acceso restringido");
  }
  return user;
}

export async function requireChefPermission(action: CpanelAction = "view") {
  const user = await requireModulePermission("food-services", action);
  if (!user.roles.some(role => role === "ADMIN" || role === "CHEF")) {
    throw new CorporateAuthorizationRequired("Acceso restringido");
  }
  return user;
}

/** General corporate consultation; an external CHEF-only account is not a collaborator. */
export function hasControlTowerAccess(user: AuthenticatedUser) {
  return Boolean(user.employee) || user.roles.some(role => role !== "CHEF");
}

export async function requireControlTowerAccess() {
  const user = await requireCorporateUser();
  if (!hasControlTowerAccess(user)) throw new CorporateAuthorizationRequired("Acceso restringido");
  return user;
}

/** Pages retain specialized purchasing/warehouse restrictions, just like their APIs. */
export async function hasModulePageAccess(user: AuthenticatedUser, module: CpanelModule, action: CpanelAction = "view", area = "") {
  if (module === "food-services" && area === "employee") {
    if (action !== "view" && action !== "operate") return false;
    const employee = await db.employee.findUnique({ where: { corporateUserId: user.id }, select: { status: true } });
    return employee?.status === "ACTIVE";
  }
  if (!(await hasModulePermission(user, module, action))) return false;
  if (module === "rrhh") return user.roles.some(role => role === "ADMIN" || role === "RH");
  if (module === "food-services" && area === "chef") return user.roles.some(role => role === "ADMIN" || role === "CHEF");
  if (module === "purchases") {
    if (area === "admin") return user.roles.includes("ADMIN");
    const permission = await db.purchasePermission.findUnique({ where: { userId: user.id } });
    if (!permission) return false;
    if (permission.canViewAll) return true;
    if (!(await hasModulePermission(user, module, "operate"))) return false;
    return permission.canRequest || (permission.canManagePurchases && await hasModulePermission(user, module, "manage"));
  }
  if (module === "warehouse") {
    if (user.roles.includes("ADMIN")) return true;
    if (area === "production") return user.roles.some(role => role === "DIRECCION" || role === "PRODUCCION");
    const permission = await db.warehousePermission.findUnique({ where: { userId: user.id } });
    const key = area === "movement" ? "canRegisterMovement" : area === "count" ? "canManageWarehouse" : "canViewInventory";
    return permission?.[key] === true;
  }
  return true;
}

/** Check a decision capability before reading the request; stage and manager ownership are checked again by the API. */
export async function requireHrDecisionPermission() {
  const user = await requireCorporateUser();
  const hr = user.roles.some(role => role === "RH" || role === "ADMIN") && await hasModulePermission(user, "rrhh", "approve");
  if (!hr && !(await hasModulePermission(user, "my-rh", "approve"))) {
    throw new CorporateAuthorizationRequired("Acceso restringido");
  }
  return user;
}
