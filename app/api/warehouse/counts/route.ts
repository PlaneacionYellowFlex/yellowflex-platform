import { randomUUID } from "crypto";
import { NextRequest,NextResponse } from "next/server";
import { WarehouseCountType } from "@prisma/client";
import { apiError } from "@/lib/api-response";
import { CorporateAuthenticationRequired, CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { getInventoryBalances, getWarehousePermission } from "@/repositories/warehouse.repository";
import { createWarehouseCount,listWarehouseCounts,WarehouseCountError } from "@/repositories/warehouse-counts.repository";

const folio=()=>`CNT-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().replaceAll("-","").slice(0,10).toUpperCase()}`;

async function requireCountOperationAccess() {
 const user=await requireCorporateUser();
 if(user.roles.includes("ADMIN"))return user;
 const permission=await getWarehousePermission(user.id);
 if(permission?.canRegisterMovement)return user;
 throw new CorporateAuthorizationRequired("No tienes permiso para registrar conteos de Almacén.");
}

export async function GET(){
 try{
  await requireCorporateUser();
  const [counts,balances]=await Promise.all([listWarehouseCounts(),getInventoryBalances()]);
  return NextResponse.json({
   counts:counts.map(c=>({id:c.id,folio:c.folio,type:c.type,status:c.status,expectedQuantity:Number(c.expectedQuantity),countedQuantity:c.countedQuantity===null?null:Number(c.countedQuantity),difference:c.difference===null?null:Number(c.difference),item:{code:c.item.code,description:c.item.description,unit:c.item.baseUnit},location:{code:c.location.code,name:c.location.name}})),
   candidates:balances.filter(b=>b.quantity>0).map(b=>({itemId:b.itemId,itemCode:b.itemCode,itemDescription:b.itemDescription,unit:b.baseUnit,locationId:b.locationId,locationCode:b.locationCode,locationName:b.locationName}))
  });
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"No fue posible consultar conteos."},{status:500});}
}
export async function POST(req:NextRequest){
 try{
  const user=await requireCountOperationAccess(); const b=await req.json();
  if(!b.itemId||!b.locationId)return NextResponse.json({error:"Artículo y ubicación son obligatorios."},{status:400});
  const c=await createWarehouseCount({folio:folio(),itemId:b.itemId,locationId:b.locationId,type:b.type==="SURPRISE"?WarehouseCountType.SURPRISE:WarehouseCountType.CYCLE,notes:b.notes,actorId:user.id});
  return NextResponse.json({id:c.id,folio:c.folio},{status:201});
 }catch(e){if(e instanceof CorporateAuthenticationRequired||e instanceof CorporateAuthorizationRequired)return apiError(e);return NextResponse.json({error:e instanceof Error?e.message:"No fue posible iniciar."},{status:e instanceof WarehouseCountError?400:500});}
}
