import "server-only";

import type { AuthenticatedUser } from "@/lib/access-control";
import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { hasModulePermission } from "@/lib/cpanel/module-access";
import { db } from "@/lib/db";

/** Identity comes only from the corporate session and RH; never from a request employeeId. */
export async function requireFoodEmployee() {
  const user = await requireCorporateUser();
  const employee = await db.employee.findUnique({
    where: { corporateUserId: user.id },
    include: { department: true, workShift: true },
  });
  if (!employee || employee.status !== "ACTIVE") {
    throw new CorporateAuthorizationRequired("El autoservicio requiere un colaborador activo vinculado en RH.");
  }
  return { user, employee };
}

export async function canEnterFoodServices(user: AuthenticatedUser) {
  const employee = await db.employee.findUnique({ where: { corporateUserId: user.id }, select: { status: true } });
  return employee?.status === "ACTIVE" || hasModulePermission(user, "food-services", "view");
}

export async function requireFoodMenuUser() {
  const user = await requireCorporateUser();
  if (!(await canEnterFoodServices(user))) throw new CorporateAuthorizationRequired("Acceso restringido");
  return user;
}
