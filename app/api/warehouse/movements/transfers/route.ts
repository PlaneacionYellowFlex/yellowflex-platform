import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { validateInventoryMovement } from "@/engines/warehouse";
import { apiError } from "@/lib/api-response";
import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { InvalidWarehouseQuantityError, parseWarehouseQuantity } from "@/lib/warehouse-quantity";
import { internalTransferIdentity } from "@/lib/warehouse-movement-idempotency";
import { getInventoryItemById, getWarehouseLocationById, getWarehousePermission, listInventoryItems, listWarehouses } from "@/repositories/warehouse.repository";
import { createInternalTransfer, InsufficientWarehouseTransferStockError, WarehouseStockOperationConflictError } from "@/repositories/warehouse-movements.repository";

async function requireAccess() {
  const user = await requireCorporateUser();
  if (user.roles.some((role) => role === "ADMIN" || role === "DIRECCION")) return user;
  const permission = await getWarehousePermission(user.id);
  if (!permission?.canRegisterMovement) throw new CorporateAuthorizationRequired("No tienes permiso para registrar movimientos de Almacén.");
  return user;
}
function folio() {
  const n=new Date();
  const d=`${n.getFullYear()}${String(n.getMonth()+1).padStart(2,"0")}${String(n.getDate()).padStart(2,"0")}`;
  return `IM-${d}-${randomUUID().replace(/-/g,"").slice(0,10).toUpperCase()}`;
}
function optional(v: unknown) { return typeof v==="string" && v.trim() ? v.trim() : null; }

export async function GET() {
  try {
    await requireAccess();
    const [items,warehouses]=await Promise.all([listInventoryItems(),listWarehouses()]);
    return NextResponse.json({
      items: items.filter(x=>x.active).map(x=>({id:x.id,code:x.code,description:x.description,baseUnit:x.baseUnit})),
      locations: warehouses.filter(w=>w.active).flatMap(w=>w.locations.filter(l=>l.active).map(l=>({id:l.id,code:l.code,name:l.name,warehouseName:w.name})))
    });
  } catch(e) { return apiError(e); }
}
export async function POST(request: Request) {
  try {
    const user=await requireAccess();
    const b=await request.json();
    const itemId=typeof b.itemId==="string"?b.itemId.trim():"";
    const originLocationId=typeof b.originLocationId==="string"?b.originLocationId.trim():"";
    const destinationLocationId=typeof b.destinationLocationId==="string"?b.destinationLocationId.trim():"";
    let quantity;
    try {
      quantity=parseWarehouseQuantity(b.quantity);
    } catch (error) {
      if (error instanceof InvalidWarehouseQuantityError) {
        return NextResponse.json({error:error.message},{status:400});
      }
      throw error;
    }
    if(!itemId) return NextResponse.json({error:"Selecciona un artículo."},{status:400});
    const v=validateInventoryMovement({type:"INTERNAL_TRANSFER",quantity:quantity.toNumber(),originLocationId,destinationLocationId});
    if(!v.valid) return NextResponse.json({error:v.error},{status:400});
    const referenceType=optional(b.referenceType),referenceNumber=optional(b.referenceNumber),notes=optional(b.notes);
    const payload={itemId,originLocationId,destinationLocationId,quantity:quantity.toFixed(3),referenceType,referenceNumber,notes};
    const identity=internalTransferIdentity(request,user.id,payload);
    if(!identity)return NextResponse.json({error:"Se requiere Idempotency-Key con UUID válido."},{status:400});
    const [item,origin,destination]=await Promise.all([
      getInventoryItemById(itemId),getWarehouseLocationById(originLocationId),
      getWarehouseLocationById(destinationLocationId)
    ]);
    if(!item?.active) return NextResponse.json({error:"El artículo no existe o está inactivo."},{status:400});
    if(!origin?.active || !origin.warehouse.active) return NextResponse.json({error:"La ubicación de origen no está disponible."},{status:400});
    if(!destination?.active || !destination.warehouse.active) return NextResponse.json({error:"La ubicación de destino no está disponible."},{status:400});
    const result=await createInternalTransfer({
      folio:folio(),itemId:item.id,quantity,unit:item.baseUnit,
      originLocationId:origin.id,originLocationCode:origin.code,destinationLocationId:destination.id,
      referenceType,referenceNumber,notes,occurredAt:new Date(),actorId:user.id,
      operationKey:identity.operationKey,operationPayloadHash:identity.operationPayloadHash,
    });
    return NextResponse.json(result,{status:201});
  } catch(e) {
    if(e instanceof InsufficientWarehouseTransferStockError || e instanceof WarehouseStockOperationConflictError) return NextResponse.json({error:e.message},{status:409});
    return apiError(e);
  }
}
