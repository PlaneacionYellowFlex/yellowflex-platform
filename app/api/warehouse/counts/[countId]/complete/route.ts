import { NextRequest,NextResponse } from "next/server";
import { requireCorporateUser } from "@/lib/auth/corporate-auth";
import { completeWarehouseCount,WarehouseCountError } from "@/repositories/warehouse-counts.repository";
export async function POST(req:NextRequest,{params}:{params:Promise<{countId:string}>}){
 try{
  const user=await requireCorporateUser(); const {countId}=await params; const b=await req.json();
  const result=await completeWarehouseCount({id:countId,countedQuantity:Number(b.countedQuantity),notes:b.notes,actorId:user.id});
  return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"No fue posible cerrar."},{status:e instanceof WarehouseCountError?400:500});}
}
