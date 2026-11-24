import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { createFoodPayrollBatch } from "@/lib/food-services/payroll-batch-service";
import { listFoodPayrollBatches } from "@/lib/food-services/payroll-batch-operations";
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

export async function GET(request: Request) {
  try {
    const user = await requirePayrollAction("view-payroll-batches");
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    return NextResponse.json(await listFoodPayrollBatches(user, params), { headers: NO_STORE });
  } catch (error) { return apiError(error); }
}

/** Generación idempotente: encabezado Idempotency-Key obligatorio; un reintento devuelve 200 con la misma respuesta. */
export async function POST(request: Request) {
  try {
    const user = await requirePayrollAction("create-payroll-batch");
    const result = await createFoodPayrollBatch(user, await request.json(), request.headers.get("Idempotency-Key"));
    return NextResponse.json({ ...result.body, replayed: result.replayed }, { status: result.status, headers: NO_STORE });
  } catch (error) { return apiError(error); }
}
