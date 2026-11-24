import { CorporateAuthenticationRequired as AuthenticationError, CorporateAuthorizationRequired as AuthorizationError } from "@/lib/auth/corporate-auth";
import { apiError } from "@/lib/api-response";
import { requireModulePermission } from "@/lib/cpanel/module-access";
import { hasCpanelPermission } from "@/lib/cpanel/authorization";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireCorporateUser } from "@/lib/auth/corporate-auth";
import { getWarehousePermission } from "@/repositories/warehouse.repository";
import { approveDiscrepancyAdjustment, WarehouseDiscrepancyError } from "@/repositories/warehouse-discrepancies.repository";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireModulePermission("warehouse", "approve");
    const user = await requireCorporateUser();
    const permission = await getWarehousePermission(user.id);
    if (!user.roles.includes("ADMIN") && (!permission?.canApproveWarehouseAdjustments || !(await hasCpanelPermission(user.id, "warehouse", "approve")))) return NextResponse.json({ error: "No tienes autorización expresa para aprobar ajustes de diferencias." }, { status: 403 });
    const { id } = await params;
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const movement = await approveDiscrepancyAdjustment(id, user.id, `AJ-${date}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`);
    return NextResponse.json({ movement });
  } catch (error) { if (error instanceof AuthenticationError || error instanceof AuthorizationError) return apiError(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible aprobar el ajuste." }, { status: error instanceof WarehouseDiscrepancyError ? 409 : 500 });
  }
}
