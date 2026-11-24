import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { downloadFoodPayrollExport, exportFoodPayrollBatch } from "@/lib/food-services/payroll-batch-operations";
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

/** Exportación oficial (una sola vez por lote). Exportar no implica que el descuento se haya aplicado. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePayrollAction("export-payroll-batch");
    const { id } = await context.params;
    const text = await request.text();
    let body: unknown = {};
    if (text) { try { body = JSON.parse(text); } catch { body = { invalidJson: true }; } }
    return NextResponse.json(await exportFoodPayrollBatch(user, id, body), { headers: NO_STORE });
  } catch (error) { return apiError(error); }
}

/** Descarga del archivo oficial registrado (mismos bytes y SHA-256 que en la exportación). */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePayrollAction("view-payroll-batches");
    const { id } = await context.params;
    const file = await downloadFoodPayrollExport(user, id);
    return new Response(new Uint8Array(file.body), { status: 200, headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "X-File-SHA256": file.fileSha256, ...NO_STORE,
    } });
  } catch (error) { return apiError(error); }
}
