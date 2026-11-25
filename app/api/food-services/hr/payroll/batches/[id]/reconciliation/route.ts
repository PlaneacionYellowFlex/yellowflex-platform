import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { CorporateAuthorizationRequired } from "@/lib/auth/corporate-auth";
import { hasCpanelPermission } from "@/lib/cpanel/authorization";
import type { CpanelAction } from "@/lib/cpanel/permission-catalog";
import { confirmReconciliation, getFoodPayrollReconciliation } from "@/lib/food-services/payroll-reconciliation";
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

const MAX_BYTES = 5 * 1024 * 1024;
/** Cuerpo binario del Excel importado (sin multipart). El límite se verifica antes de leerlo completo. */
async function readFile(request: Request) {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BYTES + 1024) return Buffer.alloc(MAX_BYTES + 1);
  return Buffer.from(await request.arrayBuffer());
}
function header(request: Request, name: string) {
  const value = request.headers.get(name);
  if (value === null) return undefined;
  try { return decodeURIComponent(value); } catch { return "\u0000"; }
}

/** Estado de conciliación del lote: KPIs, colaboradores paginados con filtros e historial (incluye conciliaciones anuladas). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePayrollAction("view-payroll-reconciliations");
    const { id } = await context.params;
    const url = new URL(request.url);
    return NextResponse.json(await getFoodPayrollReconciliation(user, id, Object.fromEntries(url.searchParams)), { headers: NO_STORE });
  } catch (error) { return apiError(error); }
}

/** Confirmación masiva de la conciliación: el mismo Excel de la vista previa, token firmado e Idempotency-Key obligatorios. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePayrollAction("register-payroll-reconciliation");
    const { id } = await context.params;
    const file = await readFile(request);
    const result = await confirmReconciliation(user, id, file, {
      fileName: header(request, "X-File-Name"), externalReference: header(request, "X-External-Reference") || undefined,
      previewToken: request.headers.get("X-Preview-Token") ?? "",
    }, request.headers.get("Idempotency-Key"));
    return NextResponse.json({ ...result.body, replayed: result.replayed }, { status: result.status, headers: NO_STORE });
  } catch (error) { return apiError(error); }
}
