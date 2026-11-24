import { CorporateAuthenticationRequired as AuthenticationError, CorporateAuthorizationRequired as AuthorizationError } from "@/lib/auth/corporate-auth";
import { apiError } from "@/lib/api-response";
import { requireModulePermission } from "@/lib/cpanel/module-access";
import { hasCpanelPermission } from "@/lib/cpanel/authorization";
import { NextRequest, NextResponse } from "next/server";
import { requireCorporateUser } from "@/lib/auth/corporate-auth";
import { getWarehousePermission } from "@/repositories/warehouse.repository";
import { updateDiscrepancy } from "@/repositories/warehouse-discrepancies.repository";
export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {
    await requireModulePermission("warehouse", "operate");
    const user=await requireCorporateUser();
    const permission=await getWarehousePermission(user.id);
    if(!user.roles.includes("ADMIN")&&(!permission?.canManageWarehouse || !(await hasCpanelPermission(user.id, "warehouse", "operate")))) return NextResponse.json({error:"Sin permiso para investigar diferencias"},{status:403});
    const {id}=await params;const body=await request.json();
    if(!["CONTROLLED_TEST","REAL"].includes(body.classification)) return NextResponse.json({error:"Clasificación inválida"},{status:400});
    const result=await updateDiscrepancy(id,{classification:body.classification,cause:String(body.cause??""),notes:String(body.notes??""),resolution:String(body.resolution??""),close:body.close===true,actorId:user.id});
    return NextResponse.json({id:result.id,status:result.status});
  }catch(e){ if (e instanceof AuthenticationError || e instanceof AuthorizationError) return apiError(e);return NextResponse.json({error:e instanceof Error?e.message:"Error al actualizar"},{status:400});}
}
