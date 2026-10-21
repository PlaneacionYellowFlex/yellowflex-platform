import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireCorporateUser } from "@/lib/auth/corporate-auth";
import { getWarehousePermission } from "@/repositories/warehouse.repository";
import { approveDiscrepancyAdjustment, WarehouseDiscrepancyError } from "@/repositories/warehouse-discrepancies.repository";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCorporateUser();
    const permission = await getWarehousePermission(user.id);
    if (!permission?.canApproveWarehouseAdjustments && !user.roles.some((role) => role === "ADMIN" || role === "DIRECCION")) return NextResponse.json({ error: "No tienes autorización expresa para aprobar ajustes de diferencias." }, { status: 403 });
    const { id } = await params;
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const movement = await approveDiscrepancyAdjustment(id, user.id, `AJ-${date}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`);
    return NextResponse.json({ movement });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible aprobar el ajuste." }, { status: error instanceof WarehouseDiscrepancyError ? 409 : 500 });
  }
}
