import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { voidFoodPayrollBatch } from "@/lib/food-services/payroll-batch-operations";
import { CorporateAuthorizationRequired } from "@/lib/auth/corporate-auth";
import { hasCpanelPermission } from "@/lib/cpanel/authorization";
import type { CpanelAction } from "@/lib/cpanel/permission-catalog";
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

/** Anulación previa a la exportación; libera las asignaciones en la misma transacción. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePayrollAction("void-payroll-batch");
    const { id } = await context.params;
    return NextResponse.json(await voidFoodPayrollBatch(user, id, await request.json()), { headers: NO_STORE });
  } catch (error) { return apiError(error); }
}
