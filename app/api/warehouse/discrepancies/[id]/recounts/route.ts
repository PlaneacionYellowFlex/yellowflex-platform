import {randomUUID} from "crypto";
import {NextRequest,NextResponse} from "next/server";
import {requireCorporateUser} from "@/lib/auth/corporate-auth";
import {getWarehousePermission} from "@/repositories/warehouse.repository";
import {requestRecount,WarehouseRecountError} from "@/repositories/warehouse-recounts.repository";
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requireCorporateUser();const p=await getWarehousePermission(user.id);
  if(!user.roles.includes("ADMIN")&&!user.roles.includes("DIRECCION")&&!p?.canManageWarehouse)return NextResponse.json({error:"Sin autorización para solicitar reconteos."},{status:403});
  const {id}=await params;const body=await req.json();
  const folio=`REC-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,10).replaceAll("-","").toUpperCase()}`;
  const result=await requestRecount(id,String(body.reason??""),user.id,folio);
  return NextResponse.json({id:result.id,folio:result.folio});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Error"},{status:e instanceof WarehouseRecountError?400:500});}
}
