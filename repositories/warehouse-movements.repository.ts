import { Prisma, type InventoryMovementType } from "@prisma/client";

import { db } from "@/lib/db";

export type CreateWarehouseMovementData = {
  folio: string;
  itemId: string;
  type: InventoryMovementType;
  quantity: number;
  unit: string;
  originLocationId?: string | null;
  destinationLocationId?: string | null;
  referenceType?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
  occurredAt: Date;
  actorId: string;
};

export async function createWarehouseMovement(
  data: CreateWarehouseMovementData,
) {
  return db.inventoryMovement.create({
    data: {
      folio: data.folio,
      itemId: data.itemId,
      type: data.type,
      quantity: new Prisma.Decimal(data.quantity),
      unit: data.unit,
      originLocationId: data.originLocationId ?? null,
      destinationLocationId: data.destinationLocationId ?? null,
      referenceType: data.referenceType?.trim() || null,
      referenceNumber: data.referenceNumber?.trim() || null,
      notes: data.notes?.trim() || null,
      occurredAt: data.occurredAt,
      actorId: data.actorId,
    },
    include: {
      item: true,
      originLocation: { include: { warehouse: true } },
      destinationLocation: { include: { warehouse: true } },
      actor: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}
