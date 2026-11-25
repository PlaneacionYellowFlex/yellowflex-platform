import { apiError } from "@/lib/api-response";
import { CorporateAuthorizationRequired } from "@/lib/auth/corporate-auth";
import { hasCpanelPermission } from "@/lib/cpanel/authorization";
import type { CpanelAction } from "@/lib/cpanel/permission-catalog";
import { downloadReconciliationEvidence } from "@/lib/food-services/payroll-reconciliation";
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

function fileResponse(file: { fileName: string; fileSha256: string; body: Buffer; contentType: string }) {
  return new Response(new Uint8Array(file.body), { status: 200, headers: {
    "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"`, "X-File-SHA256": file.fileSha256, ...NO_STORE,
  } });
}

/** Evidencia original importada (mismos bytes y SHA-256 registrados al conciliar). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePayrollAction("view-payroll-reconciliations");
    const { id } = await context.params;
    const reconciliationId = new URL(request.url).searchParams.get("reconciliationId") ?? "";
    return fileResponse(await downloadReconciliationEvidence(user, id, reconciliationId));
  } catch (error) { return apiError(error); }
}
