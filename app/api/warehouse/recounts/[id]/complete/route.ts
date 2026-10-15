import {NextRequest,NextResponse} from "next/server";
import {requireCorporateUser} from "@/lib/auth/corporate-auth";
import {getWarehousePermission} from "@/repositories/warehouse.repository";
import {completeRecount,WarehouseRecountError} from "@/repositories/warehouse-recounts.repository";
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requireCorporateUser();const p=await getWarehousePermission(user.id);
  if(!user.roles.includes("ADMIN")&&!user.roles.includes("DIRECCION")&&!p?.canManageWarehouse)return NextResponse.json({error:"Sin autorización para completar reconteos."},{status:403});
  const {id}=await params;const body=await req.json();
  const result=await completeRecount(id,Number(body.countedQuantity),String(body.notes??""),user.id);
  return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Error"},{status:e instanceof WarehouseRecountError?400:500});}
}
