import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { operationIdentity } from "@/lib/warehouse-idempotency";
import { consumeProductionCustody, InvalidProductionCustodyOperationError } from "@/repositories/warehouse-custody.repository";
async function access(){ const u=await requireCorporateUser(); if(u.roles.some(r=>r==="ADMIN"||r==="DIRECCION"||r==="PRODUCCION")) return u; throw new CorporateAuthorizationRequired("No tienes permiso para registrar consumos de Producción."); }
export async function POST(request:Request, context:{params:Promise<{custodyId:string}>}){
 try { const user=await access(); const {custodyId}=await context.params; const body=await request.json(); const payload={quantity:Number(body.quantity),referenceNumber:typeof body.referenceNumber==="string"?body.referenceNumber.trim():"",notes:typeof body.notes==="string"?body.notes.trim()||null:null}; const identity=operationIdentity(request,user.id,"CONSUME_PRODUCTION_CUSTODY",custodyId,payload); if(!identity)return NextResponse.json({error:"Se requiere Idempotency-Key con UUID válido."},{status:400}); const result=await consumeProductionCustody({ custodyId, ...payload, actorId:user.id, occurredAt:new Date(), operationKey:identity.key, operationPayloadHash:identity.hash }); return NextResponse.json(result); }
 catch(error){ if(error instanceof InvalidProductionCustodyOperationError) return NextResponse.json({error:error.message},{status:409}); return apiError(error); }
}
