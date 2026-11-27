import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { NextResponse } from "next/server";
import { warehouseApiError } from "@/lib/warehouse/api-error";
import { operationIdentity } from "@/lib/warehouse-idempotency";
import { consumeProductionCustody } from "@/repositories/warehouse-custody.repository";
export async function POST(request:Request, context:{params:Promise<{custodyId:string}>}){
 try {
    const user=await requireWarehouseCapability("production"); const {custodyId}=await context.params; const body=await request.json(); const payload={quantity:Number(body.quantity),referenceNumber:typeof body.referenceNumber==="string"?body.referenceNumber.trim():"",notes:typeof body.notes==="string"?body.notes.trim()||null:null}; const identity=operationIdentity(request,user.id,"CONSUME_PRODUCTION_CUSTODY",custodyId,payload); if(!identity)return NextResponse.json({error:"Se requiere Idempotency-Key con UUID válido."},{status:400}); const result=await consumeProductionCustody({ custodyId, ...payload, actorId:user.id, occurredAt:new Date(), operationKey:identity.key, operationPayloadHash:identity.hash }); return NextResponse.json(result); }
 catch(error){ return warehouseApiError(error); }
}
