import { Prisma, type InventoryMovementType } from "@prisma/client";

import { db } from "@/lib/db";
import { payloadHash } from "@/lib/warehouse-idempotency";
import { internalTransferKind } from "@/lib/warehouse-movement-idempotency";
import { isSerializationConflict, isUniqueConflict } from "@/lib/warehouse-idempotency";
import { getWarehouseStockBalance, lockWarehouseStock } from "@/repositories/warehouse-stock-lock";

type InboundInventoryMovementType = Extract<
  InventoryMovementType,
  "INITIAL_BALANCE" | "EXTERNAL_RECEIPT" | "OPERATIONAL_RETURN" | "ADJUSTMENT_IN"
>;
const inboundMovementTypes: readonly InboundInventoryMovementType[] = [
  "INITIAL_BALANCE",
  "EXTERNAL_RECEIPT",
  "OPERATIONAL_RETURN",
  "ADJUSTMENT_IN",
];

export type CreateWarehouseMovementData = {
  folio: string;
  itemId: string;
  type: InboundInventoryMovementType;
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

export class InsufficientWarehouseTransferStockError extends Error {
  constructor(available: Prisma.Decimal, requested: Prisma.Decimal, unit: string, originCode: string) {
    super(`Existencia insuficiente en ${originCode}. Disponible: ${available.toString()} ${unit}. Solicitado: ${requested.toString()} ${unit}.`);
    this.name = "InsufficientWarehouseTransferStockError";
  }
}

export class WarehouseStockOperationConflictError extends Error {
  constructor() {
    super("La clave de idempotencia ya fue usada con un payload distinto.");
    this.name = "WarehouseStockOperationConflictError";
  }
}

export type InternalTransferResponse = {
  movement: {
    folio: string;
    itemId: string;
    itemCode: string;
    quantity: number;
    unit: string;
    originLocation: { id: string; code: string } | null;
    destinationLocation: { id: string; code: string } | null;
  };
};

export type CreateInternalTransferData = {
  folio: string;
  itemId: string;
  quantity: Prisma.Decimal;
  unit: string;
  originLocationId: string;
  originLocationCode: string;
  destinationLocationId: string;
  referenceType?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
  occurredAt: Date;
  actorId: string;
  operationKey: string;
  operationPayloadHash: string;
};

function readPriorTransfer(
  previous: { operationPayloadHash: string; responseBody: Prisma.JsonValue | null },
  requestHash: string,
): InternalTransferResponse {
  if (previous.operationPayloadHash !== requestHash) {
    throw new WarehouseStockOperationConflictError();
  }
  return previous.responseBody as InternalTransferResponse;
}

export async function createWarehouseMovement(
  data: CreateWarehouseMovementData,
) {
  if (!inboundMovementTypes.includes(data.type) || data.originLocationId) {
    throw new Error("Los movimientos de egreso deben usar el repositorio transaccional protegido.");
  }

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

export async function createInternalTransfer(data: CreateInternalTransferData) {
  const referenceType = data.referenceType?.trim() || null;
  const referenceNumber = data.referenceNumber?.trim() || null;
  const notes = data.notes?.trim() || null;
  const quantity = data.quantity.toFixed(3);
  const requestBody = {
    itemId: data.itemId,
    originLocationId: data.originLocationId,
    destinationLocationId: data.destinationLocationId,
    quantity,
    referenceType,
    referenceNumber,
    notes,
  };
  const requestHash = payloadHash({
    kind: internalTransferKind,
    actorId: data.actorId,
    payload: requestBody,
  });
  if (data.operationPayloadHash !== requestHash) {
    throw new WarehouseStockOperationConflictError();
  }

  const readExisting = async () => {
    const previous = await db.warehouseStockOperation.findUnique({
      where: { operationKey: data.operationKey },
      select: { operationPayloadHash: true, responseBody: true },
    });
    return previous ? readPriorTransfer(previous, requestHash) : null;
  };

  const prior = await readExisting();
  if (prior) return prior;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        await lockWarehouseStock(tx, data.itemId, data.originLocationId);

        const previous = await tx.warehouseStockOperation.findUnique({
          where: { operationKey: data.operationKey },
          select: { operationPayloadHash: true, responseBody: true },
        });
        if (previous) return readPriorTransfer(previous, requestHash);

        const available = await getWarehouseStockBalance(tx, data.itemId, data.originLocationId);
        if (available.lessThan(data.quantity)) {
          throw new InsufficientWarehouseTransferStockError(available, data.quantity, data.unit, data.originLocationCode);
        }

        const movement = await tx.inventoryMovement.create({
          data: {
            folio: data.folio,
            itemId: data.itemId,
            type: "INTERNAL_TRANSFER",
            quantity: data.quantity,
            unit: data.unit,
            originLocationId: data.originLocationId,
            destinationLocationId: data.destinationLocationId,
            referenceType,
            referenceNumber,
            notes,
            occurredAt: data.occurredAt,
            actorId: data.actorId,
          },
          include: {
            item: true,
            originLocation: true,
            destinationLocation: true,
          },
        });

        const response: InternalTransferResponse = {
          movement: {
            folio: movement.folio,
            itemId: movement.itemId,
            itemCode: movement.item.code,
            quantity: movement.quantity.toNumber(),
            unit: movement.unit,
            originLocation: movement.originLocation ? { id: movement.originLocation.id, code: movement.originLocation.code } : null,
            destinationLocation: movement.destinationLocation ? { id: movement.destinationLocation.id, code: movement.destinationLocation.code } : null,
          },
        };

        await tx.warehouseStockOperation.create({
          data: {
            operationKey: data.operationKey,
            operationPayloadHash: requestHash,
            kind: internalTransferKind,
            actorId: data.actorId,
            requestBody,
            responseBody: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonObject,
            processedAt: data.occurredAt,
          },
        });

        return response;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (isUniqueConflict(error) || isSerializationConflict(error)) {
        const completed = await readExisting();
        if (completed) return completed;
        if (isSerializationConflict(error) && attempt < 2) continue;
      }
      throw error;
    }
  }
}
