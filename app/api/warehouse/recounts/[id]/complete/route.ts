import { CorporateAuthenticationRequired as AuthenticationError, CorporateAuthorizationRequired as AuthorizationError } from "@/lib/auth/corporate-auth";
import { apiError } from "@/lib/api-response";
import { requireModulePermission } from "@/lib/cpanel/module-access";
import { hasCpanelPermission } from "@/lib/cpanel/authorization";
import {NextRequest,NextResponse} from "next/server";
import {requireCorporateUser} from "@/lib/auth/corporate-auth";
import {getWarehousePermission} from "@/repositories/warehouse.repository";
import {completeRecount,WarehouseRecountError} from "@/repositories/warehouse-recounts.repository";
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
    await requireModulePermission("warehouse", "operate");
  const user=await requireCorporateUser();const p=await getWarehousePermission(user.id);
  if(!user.roles.includes("ADMIN")&&(!p?.canManageWarehouse || !(await hasCpanelPermission(user.id, "warehouse", "operate"))))return NextResponse.json({error:"Sin autorización para completar reconteos."},{status:403});
  const {id}=await params;const body=await req.json();
  const result=await completeRecount(id,Number(body.countedQuantity),String(body.notes??""),user.id);
  return NextResponse.json(result);
 }catch(e){ if (e instanceof AuthenticationError || e instanceof AuthorizationError) return apiError(e);return NextResponse.json({error:e instanceof Error?e.message:"Error"},{status:e instanceof WarehouseRecountError?400:500});}
}
