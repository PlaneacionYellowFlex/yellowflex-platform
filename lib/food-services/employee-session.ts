import "server-only";
import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { hasModulePermission } from "@/lib/cpanel/module-access";
import type { CpanelAction } from "@/lib/cpanel/permission-catalog";
import { CorporateAuthorizationRequired } from "@/lib/auth/corporate-auth";

const cookieName = "yf_food_access";
const sessionMinutes = Number(process.env.FOOD_ACCESS_SESSION_MINUTES ?? 30);
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function requireEmployeeAccess(employeeId: string, action: CpanelAction = "view") {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { corporateUser: { include: { roles: true } } },
  });
  if (employee?.corporateUser?.passwordMustChange) {
    throw new CorporateAuthorizationRequired("Debes cambiar tu contraseña temporal antes de continuar.");
  }
  const account = employee?.corporateUser;
  if (!account?.active || !(await hasModulePermission({ ...account, employee: null, roles: account.roles.map(r => r.role) }, "food-services", action))) {
    throw new CorporateAuthorizationRequired("Acceso restringido");
  }
}

export async function createEmployeeSession(employeeId: string) {
  await requireEmployeeAccess(employeeId);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionMinutes * 60_000);
  await db.foodAccessSession.create({ data: { employeeId, tokenHash: hashToken(token), expiresAt } });
  const store = await cookies();
  store.set(cookieName, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
}

export async function invalidateEmployeeSessions(
  employeeId: string,
) {
  await db.foodAccessSession.deleteMany({
    where: {
      employeeId,
    },
  });

  const store = await cookies();
  store.delete(cookieName);
}
export async function getEmployeeSession(action: CpanelAction = "view") {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const session = await db.foodAccessSession.findFirst({ where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() }, employee: { status: "ACTIVE" } }, select: { id: true, employee: { select: { id: true, employeeNumber: true, fullName: true } } } });
  if (session) await requireEmployeeAccess(session.employee.id, action);
  return session;
}
