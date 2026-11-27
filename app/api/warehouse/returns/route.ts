import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { listWarehouseReturnsInTransit } from "@/repositories/warehouse-custody.repository";
import { listWarehouses } from "@/repositories/warehouse.repository";
export async function GET(){ try {
    await requireWarehouseCapability("operate"); const [rows,warehouses]=await Promise.all([listWarehouseReturnsInTransit(),listWarehouses()]); return NextResponse.json({ returns:rows.map(c=>({id:c.id,folio:c.folio,quantity:c.quantity.toNumber(),unit:c.unit,enteredAt:c.enteredAt,notes:c.notes,item:{id:c.item.id,code:c.item.code,description:c.item.description}})), locations:warehouses.filter(w=>w.active).flatMap(w=>w.locations.filter(l=>l.active).map(l=>({id:l.id,code:l.code,name:l.name,warehouseName:w.name}))) }); } catch(error){ return apiError(error); } }
