import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { listWarehouseReturnsInTransit } from "@/repositories/warehouse-custody.repository";
import { getWarehousePermission, listWarehouses } from "@/repositories/warehouse.repository";
async function access(){ const u=await requireCorporateUser(); if(u.roles.some(r=>r==="ADMIN"||r==="DIRECCION")) return u; const p=await getWarehousePermission(u.id); if(p?.canRegisterMovement) return u; throw new CorporateAuthorizationRequired("No tienes permiso para recibir devoluciones de Almacén."); }
export async function GET(){ try { await access(); const [rows,warehouses]=await Promise.all([listWarehouseReturnsInTransit(),listWarehouses()]); return NextResponse.json({ returns:rows.map(c=>({id:c.id,folio:c.folio,quantity:c.quantity.toNumber(),unit:c.unit,enteredAt:c.enteredAt,notes:c.notes,item:{id:c.item.id,code:c.item.code,description:c.item.description}})), locations:warehouses.filter(w=>w.active).flatMap(w=>w.locations.filter(l=>l.active).map(l=>({id:l.id,code:l.code,name:l.name,warehouseName:w.name}))) }); } catch(error){ return apiError(error); } }
