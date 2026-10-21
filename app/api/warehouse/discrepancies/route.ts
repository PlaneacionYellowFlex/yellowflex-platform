import { NextResponse } from "next/server";
import { requireCorporateUser } from "@/lib/auth/corporate-auth";
import { getWarehousePermission } from "@/repositories/warehouse.repository";
import { listDiscrepancies } from "@/repositories/warehouse-discrepancies.repository";
export async function GET() {
  try {
    const user = await requireCorporateUser();
    const permission = await getWarehousePermission(user.id);
    if (!user.roles.includes("ADMIN") && !user.roles.includes("DIRECCION") && !permission?.canViewInventory) return NextResponse.json({error:"Acceso no autorizado"},{status:403});
    const cases = await listDiscrepancies();
    return NextResponse.json({ canApproveAdjustments: permission?.canApproveWarehouseAdjustments === true || user.roles.some((role) => role === "ADMIN" || role === "DIRECCION"), cases: cases.map(c=>({id:c.id,folio:c.folio,status:c.status,classification:c.classification,cause:c.cause,notes:c.notes,resolution:c.resolution,assignedTo:c.assignedTo?.name??null,expected:Number(c.count.expectedQuantity),counted:Number(c.count.countedQuantity),difference:Number(c.count.difference),countFolio:c.count.folio,itemCode:c.count.item.code,itemDescription:c.count.item.description,unit:c.count.item.baseUnit,locationCode:c.count.location.code,approvedAt:c.approvedAt,approvedBy:c.approvedBy?.name??null,approvedQuantity:c.approvedQuantity?.toNumber()??null,movement:c.adjustmentMovement?{folio:c.adjustmentMovement.folio,type:c.adjustmentMovement.type,quantity:c.adjustmentMovement.quantity.toNumber()}:null,recounts:c.recounts.map(r=>({id:r.id,folio:r.folio,status:r.status,reason:r.reason,notes:r.notes,countedQuantity:r.status==="COMPLETED"?Number(r.countedQuantity):null,difference:r.status==="COMPLETED"?Number(r.difference):null,requestedAt:r.requestedAt,requestedBy:r.requestedBy.name,completedBy:r.completedBy?.name??null,completedById:r.completedBy?.id??null}))})) });
  } catch(e) {return NextResponse.json({error:e instanceof Error?e.message:"Error de consulta"},{status:500});}
}
