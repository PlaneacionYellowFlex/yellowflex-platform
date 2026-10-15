import { NextRequest,NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { CorporateAuthenticationRequired, CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { getWarehousePermission } from "@/repositories/warehouse.repository";
import { completeWarehouseCount,WarehouseCountError } from "@/repositories/warehouse-counts.repository";

async function requireCountOperationAccess() {
 const user=await requireCorporateUser();
 if(user.roles.includes("ADMIN"))return user;
 const permission=await getWarehousePermission(user.id);
 if(permission?.canRegisterMovement)return user;
 throw new CorporateAuthorizationRequired("No tienes permiso para cerrar conteos de Almacén.");
}

export async function POST(req:NextRequest,{params}:{params:Promise<{countId:string}>}){
 try{
  const user=await requireCountOperationAccess(); const {countId}=await params; const b=await req.json();
  const result=await completeWarehouseCount({id:countId,countedQuantity:Number(b.countedQuantity),notes:b.notes,actorId:user.id});
  return NextResponse.json(result);
 }catch(e){if(e instanceof CorporateAuthenticationRequired||e instanceof CorporateAuthorizationRequired)return apiError(e);return NextResponse.json({error:e instanceof Error?e.message:"No fue posible cerrar."},{status:e instanceof WarehouseCountError?400:500});}
}
