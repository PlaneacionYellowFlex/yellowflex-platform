import { Prisma, WarehouseCountType } from "@prisma/client";
import { db } from "@/lib/db";

export class WarehouseCountError extends Error {}

async function balance(tx: Prisma.TransactionClient, itemId: string, locationId: string) {
  const [incoming, outgoing] = await Promise.all([
    tx.inventoryMovement.aggregate({ where: { itemId, destinationLocationId: locationId }, _sum: { quantity: true } }),
    tx.inventoryMovement.aggregate({ where: { itemId, originLocationId: locationId }, _sum: { quantity: true } }),
  ]);
  return new Prisma.Decimal(incoming._sum.quantity ?? 0).minus(outgoing._sum.quantity ?? 0);
}

export function listWarehouseCounts() {
  return db.warehouseCount.findMany({
    include: { item: true, location: { include: { warehouse: true } } },
    orderBy: [{ status: "asc" }, { launchedAt: "desc" }],
  });
}

export async function createWarehouseCount(data: {
  folio: string;
  itemId: string;
  locationId: string;
  type: WarehouseCountType;
  notes?: string;
  actorId: string;
}) {
  return db.$transaction(async (tx) => {
    const open = await tx.warehouseCount.findFirst({
      where: { itemId: data.itemId, locationId: data.locationId, status: "OPEN" },
    });
    if (open) throw new WarehouseCountError(`Ya existe un conteo abierto: ${open.folio}.`);
    const expectedQuantity = await balance(tx, data.itemId, data.locationId);
    return tx.warehouseCount.create({
      data: {
        folio: data.folio,
        itemId: data.itemId,
        locationId: data.locationId,
        type: data.type,
        notes: data.notes?.trim() || null,
        expectedQuantity,
        launchedAt: new Date(),
        createdById: data.actorId,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function completeWarehouseCount(data: {
  id: string;
  countedQuantity: number;
  notes?: string;
  actorId: string;
}) {
  return db.$transaction(async (tx) => {
    const count = await tx.warehouseCount.findUnique({ where: { id: data.id } });
    if (!count || count.status !== "OPEN") throw new WarehouseCountError("El conteo no está abierto.");
    if (!Number.isFinite(data.countedQuantity) || data.countedQuantity < 0) {
      throw new WarehouseCountError("Cantidad contada inválida.");
    }
    const changed=await tx.inventoryMovement.count({
      where:{
        itemId:count.itemId,
        createdAt:{gt:count.launchedAt},
        OR:[{originLocationId:count.locationId},{destinationLocationId:count.locationId}],
      },
    });
    if(changed>0) throw new WarehouseCountError(
      `Se registraron ${changed} movimiento(s) desde que inició el conteo. No puede cerrarse con una existencia teórica desactualizada. Requiere revisión y nuevo conteo.`
    );
    const counted = new Prisma.Decimal(data.countedQuantity);
    const difference = counted.minus(count.expectedQuantity);
    await tx.warehouseCount.update({
      where: { id: count.id },
      data: {
        status: "COMPLETED",
        countedQuantity: counted,
        difference,
        countedAt: new Date(),
        countedById: data.actorId,
        notes: data.notes?.trim() || count.notes,
      },
    });
    if (!difference.isZero()) {
      await tx.warehouseDiscrepancy.create({
        data: {
          folio: `DIS-${count.folio.replace(/^CNT-/, "")}`,
          countId: count.id,
          status: "OPEN",
          classification: "UNCLASSIFIED",
        },
      });
    }
    return {
      folio: count.folio,
      expected: Number(count.expectedQuantity),
      counted: Number(counted),
      difference: Number(difference),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
