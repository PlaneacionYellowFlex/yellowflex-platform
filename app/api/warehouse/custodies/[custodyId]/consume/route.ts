import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { consumeProductionCustody, InvalidProductionCustodyOperationError } from "@/repositories/warehouse-custody.repository";
async function access(){ const u=await requireCorporateUser(); if(u.roles.some(r=>r==="ADMIN"||r==="DIRECCION"||r==="PRODUCCION")) return u; throw new CorporateAuthorizationRequired("No tienes permiso para registrar consumos de Producción."); }
export async function POST(request:Request, context:{params:Promise<{custodyId:string}>}){
 try { const user=await access(); const {custodyId}=await context.params; const body=await request.json(); const result=await consumeProductionCustody({custodyId,quantity:Number(body.quantity),referenceNumber:typeof body.referenceNumber==="string"?body.referenceNumber:"",notes:typeof body.notes==="string"?body.notes:null,actorId:user.id,occurredAt:new Date()}); return NextResponse.json(result); }
 catch(error){ if(error instanceof InvalidProductionCustodyOperationError) return NextResponse.json({error:error.message},{status:409}); return apiError(error); }
}
