import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export class WarehouseRecountError extends Error {}

async function balance(tx: Prisma.TransactionClient, itemId: string, locationId: string) {
  const incoming = await tx.inventoryMovement.aggregate({where:{itemId,destinationLocationId:locationId},_sum:{quantity:true}});
  const outgoing = await tx.inventoryMovement.aggregate({where:{itemId,originLocationId:locationId},_sum:{quantity:true}});
  return new Prisma.Decimal(incoming._sum.quantity ?? 0).minus(outgoing._sum.quantity ?? 0);
}

export async function requestRecount(discrepancyId:string,reason:string,actorId:string,folio:string){
 if(reason.trim().length<8)throw new WarehouseRecountError("Indica el motivo del reconteo (mínimo 8 caracteres).");
 return db.$transaction(async tx=>{
  const c=await tx.warehouseDiscrepancy.findUnique({where:{id:discrepancyId},include:{count:true}});
  if(!c||c.status==="CLOSED")throw new WarehouseRecountError("Expediente inexistente o cerrado.");
  if(c.classification!=="REAL")throw new WarehouseRecountError("Solo las diferencias reales permiten reconteo.");
  const open=await tx.warehouseDiscrepancyRecount.findFirst({where:{discrepancyId,status:"OPEN"}});
  if(open)throw new WarehouseRecountError("Ya existe un reconteo abierto.");
  const expected=await balance(tx,c.count.itemId,c.count.locationId);
  return tx.warehouseDiscrepancyRecount.create({data:{folio,discrepancyId,reason:reason.trim(),requestedById:actorId,expectedQuantity:expected}});
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}

export async function completeRecount(id:string,quantity:number,notes:string,actorId:string){
 if(!Number.isFinite(quantity)||quantity<0||Math.round(quantity*1000)!==quantity*1000)throw new WarehouseRecountError("Cantidad inválida; máximo tres decimales.");
 return db.$transaction(async tx=>{
  const r=await tx.warehouseDiscrepancyRecount.findUnique({where:{id},include:{discrepancy:{include:{count:true}}}});
  if(!r||r.status!=="OPEN")throw new WarehouseRecountError("El reconteo ya no está abierto.");
  const c=r.discrepancy;
  if(c.status==="CLOSED")throw new WarehouseRecountError("La investigación está cerrada.");
  const changed=await tx.inventoryMovement.count({where:{itemId:c.count.itemId,createdAt:{gt:r.requestedAt},OR:[{originLocationId:c.count.locationId},{destinationLocationId:c.count.locationId}]}});
  if(changed)throw new WarehouseRecountError("Hubo movimientos después de solicitar el reconteo. No puede cerrarse; requiere revisión.");
  const counted=new Prisma.Decimal(quantity);
  const result=await tx.warehouseDiscrepancyRecount.update({where:{id,status:"OPEN"},data:{status:"COMPLETED",countedQuantity:counted,difference:counted.minus(r.expectedQuantity),notes:notes.trim()||null,completedById:actorId,completedAt:new Date()}});
  return {folio:result.folio,difference:Number(result.difference)};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
