import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { validateInventoryMovement } from "@/engines/warehouse";
import { apiError } from "@/lib/api-response";
import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { getInventoryBalancesByItem, getInventoryItemById, getWarehouseLocationById, getWarehousePermission, listInventoryItems, listWarehouses } from "@/repositories/warehouse.repository";
import { createWarehouseMovement } from "@/repositories/warehouse-movements.repository";

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
    const quantity=Number(b.quantity);
    if(!itemId) return NextResponse.json({error:"Selecciona un artículo."},{status:400});
    const v=validateInventoryMovement({type:"INTERNAL_TRANSFER",quantity,originLocationId,destinationLocationId});
    if(!v.valid) return NextResponse.json({error:v.error},{status:400});
    const [item,origin,destination,balances]=await Promise.all([
      getInventoryItemById(itemId),getWarehouseLocationById(originLocationId),
      getWarehouseLocationById(destinationLocationId),getInventoryBalancesByItem(itemId)
    ]);
    if(!item?.active) return NextResponse.json({error:"El artículo no existe o está inactivo."},{status:400});
    if(!origin?.active || !origin.warehouse.active) return NextResponse.json({error:"La ubicación de origen no está disponible."},{status:400});
    if(!destination?.active || !destination.warehouse.active) return NextResponse.json({error:"La ubicación de destino no está disponible."},{status:400});
    const available=balances.find(x=>x.locationId===originLocationId)?.quantity ?? 0;
    if(available<quantity) return NextResponse.json({error:`Existencia insuficiente en ${origin.code}. Disponible: ${available} ${item.baseUnit}.`},{status:409});
    const m=await createWarehouseMovement({
      folio:folio(),itemId:item.id,type:"INTERNAL_TRANSFER",quantity,unit:item.baseUnit,
      originLocationId:origin.id,destinationLocationId:destination.id,
      referenceType:optional(b.referenceType),referenceNumber:optional(b.referenceNumber),
      notes:optional(b.notes),occurredAt:new Date(),actorId:user.id
    });
    return NextResponse.json({movement:{
      folio:m.folio,itemId:m.itemId,itemCode:m.item.code,quantity:m.quantity.toNumber(),unit:m.unit,
      originLocation:m.originLocation?{id:m.originLocation.id,code:m.originLocation.code}:null,
      destinationLocation:m.destinationLocation?{id:m.destinationLocation.id,code:m.destinationLocation.code}:null
    }},{status:201});
  } catch(e) { return apiError(e); }
}
