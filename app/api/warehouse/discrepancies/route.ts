import { NextResponse } from "next/server";
import { getWarehouseCapabilities, requireWarehouseCapability } from "@/lib/warehouse/access";
import { warehouseApiError } from "@/lib/warehouse/api-error";
import { listDiscrepancies } from "@/repositories/warehouse-discrepancies.repository";
export async function GET() {
  try {
    const user = await requireWarehouseCapability("view");
    const caps = await getWarehouseCapabilities(user.id, undefined, user.roles);
    const cases = await listDiscrepancies();
    return NextResponse.json({ canOperate: caps.investigate, canApproveAdjustments: caps.approve, currentUserId: user.id, cases: cases.map(c=>({id:c.id,folio:c.folio,status:c.status,classification:c.classification,cause:c.cause,notes:c.notes,resolution:c.resolution,assignedTo:c.assignedTo?.name??null,assignedToId:c.assignedTo?.id??null,countedById:c.count.countedById??null,expected:Number(c.count.expectedQuantity),counted:Number(c.count.countedQuantity),difference:Number(c.count.difference),countFolio:c.count.folio,itemCode:c.count.item.code,itemDescription:c.count.item.description,unit:c.count.item.baseUnit,locationCode:c.count.location.code,approvedAt:c.approvedAt,approvedBy:c.approvedBy?.name??null,approvedQuantity:c.approvedQuantity?.toNumber()??null,movement:c.adjustmentMovement?{folio:c.adjustmentMovement.folio,type:c.adjustmentMovement.type,quantity:c.adjustmentMovement.quantity.toNumber()}:null,recounts:c.recounts.map(r=>({id:r.id,folio:r.folio,status:r.status,reason:r.reason,notes:r.notes,countedQuantity:r.status==="COMPLETED"?Number(r.countedQuantity):null,difference:r.status==="COMPLETED"?Number(r.difference):null,requestedAt:r.requestedAt,requestedBy:r.requestedBy.name,completedBy:r.completedBy?.name??null,completedById:r.completedBy?.id??null})),
      // YF-003: participantes (contó, recontó, solicitó reconteo, clasificó o documentó) e historial inmutable del expediente.
      participantIds:[...new Set([c.count.countedById,c.assignedTo?.id,...c.recounts.flatMap(r=>[r.requestedBy.id,r.completedBy?.id]),
        ...c.events.filter(e=>["CLASSIFIED","UPDATED","RECOUNT_REQUESTED","RECOUNT_COMPLETED"].includes(e.type)).map(e=>e.actor.id)].filter((v):v is string=>!!v))],
      events:c.events.map(e=>({id:e.id,type:e.type,notes:e.notes,actor:e.actor?.name??null,createdAt:e.createdAt}))})) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return warehouseApiError(error); }
}
