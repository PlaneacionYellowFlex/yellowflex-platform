import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { CorporateAuthorizationRequired } from "@/lib/auth/corporate-auth";
import { hasCpanelPermission } from "@/lib/cpanel/authorization";
import type { CpanelAction } from "@/lib/cpanel/permission-catalog";
import { resolveFoodPayrollAdjustment } from "@/lib/food-services/payroll-reconciliation";
import { requireFoodServicesRhAccess } from "@/lib/food-services/rh-authorization";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

/** Acceso al módulo RH de Food Services y, además, la acción de prenómina explícita (sin atajo ADMIN). */
async function requirePayrollAction(action: CpanelAction) {
  const user = await requireFoodServicesRhAccess();
  if (!user.roles.includes("RH") || !(await hasCpanelPermission(user.id, "food-services", action))) {
    throw new CorporateAuthorizationRequired("Acceso restringido");
  }
  return user;
}

async function jsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { invalidJson: true }; }
}

/** Resolución trazable de un ajuste (recuperado, devuelto, compensado, corregido o condonado). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePayrollAction("manage-payroll-adjustments");
    const { id } = await context.params;
    return NextResponse.json(await resolveFoodPayrollAdjustment(user, id, await jsonBody(request)), { headers: NO_STORE });
  } catch (error) { return apiError(error); }
}
