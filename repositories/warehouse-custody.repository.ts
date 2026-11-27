import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { isSerializationConflict, isUniqueConflict, payloadHash } from "@/lib/warehouse-idempotency";
import { assertActiveCatalog } from "@/repositories/warehouse-catalog-guard";
import { custodyLockKey, getWarehouseStockBalance, lockWarehouseKeys, lockWarehouseStock, stockLockKey } from "@/repositories/warehouse-stock-lock";
import { runStockOperationOnce } from "@/repositories/warehouse-stock-operation.repository";

export type CreateOperationalHandoffData = {
  movementFolio: string;
  custodyFolio: string;
  itemId: string;
  quantity: Prisma.Decimal;
  unit: string;
  originLocationId: string;
  warehouseAreaId: string;
  productionAreaId: string;
  referenceType?: string | null;
  referenceNumber?: string | null;
  reason?: string | null;
  notes?: string | null;
  occurredAt: Date;
  actorId: string;
};

export class InsufficientWarehouseStockError extends Error {
  constructor(
    public readonly available: number,
    public readonly requested: number,
  ) {
    super(
      `Existencia insuficiente en la ubicación de origen. Disponible: ${available}. Solicitado: ${requested}.`,
    );
    this.name = "InsufficientWarehouseStockError";
  }
}

export async function createOperationalHandoff(
  data: CreateOperationalHandoffData,
) {
  return db.$transaction(
    async (tx) => handoffInTransaction(tx, data),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  );
}

/** YF-003: entrega a Producción exactamente una vez por Idempotency-Key (doble clic, reintento o concurrencia). */
export async function createOperationalHandoffOnce<R extends Record<string, unknown>>(
  data: CreateOperationalHandoffData,
  operation: { idempotencyKey: string; payload: Record<string, unknown> },
  toResponse: (result: Awaited<ReturnType<typeof handoffInTransaction>>) => R,
) {
  return runStockOperationOnce({
    kind: "OPERATIONAL_HANDOFF", actorId: data.actorId, idempotencyKey: operation.idempotencyKey, payload: operation.payload,
    lock: { itemId: data.itemId, locationId: data.originLocationId }, occurredAt: data.occurredAt,
  }, async tx => toResponse(await handoffInTransaction(tx, data)));
}

async function handoffInTransaction(tx: Prisma.TransactionClient, data: CreateOperationalHandoffData) {
      await lockWarehouseStock(tx, data.itemId, data.originLocationId);
      await assertActiveCatalog(tx, data.itemId, [data.originLocationId]);
      const available = await getWarehouseStockBalance(tx, data.itemId, data.originLocationId);

      if (available.lessThan(data.quantity)) {
        throw new InsufficientWarehouseStockError(available.toNumber(), data.quantity.toNumber());
      }

      const movement = await tx.inventoryMovement.create({
        data: {
          folio: data.movementFolio,
          itemId: data.itemId,
          type: "OPERATIONAL_HANDOFF",
          quantity: data.quantity,
          unit: data.unit,
          originLocationId: data.originLocationId,
          destinationLocationId: null,
          referenceType: data.referenceType?.trim() || null,
          referenceNumber: data.referenceNumber?.trim() || null,
          notes: data.notes?.trim() || null,
          occurredAt: data.occurredAt,
          actorId: data.actorId,
        },
      });

      const custody = await tx.inventoryCustody.create({
        data: {
          folio: data.custodyFolio,
          itemId: data.itemId,
          quantity: data.quantity,
          unit: data.unit,
          locationId: null,
          custodianAreaId: data.productionAreaId,
          nextActionAreaId: data.productionAreaId,
          status: "IN_TRANSIT",
          reason: data.reason?.trim() || "Entrega operativa a Producción",
          referenceType: data.referenceType?.trim() || null,
          referenceNumber: data.referenceNumber?.trim() || null,
          notes: data.notes?.trim() || null,
          enteredAt: data.occurredAt,
          createdById: data.actorId,
          // YF-003 V2: vínculo explícito y único con el movimiento de entrega que abrió la custodia.
          sourceMovementId: movement.id,
          events: {
            create: [
              {
                type: "CREATED",
                fromAreaId: data.warehouseAreaId,
                toAreaId: data.productionAreaId,
                fromStatus: "AVAILABLE",
                toStatus: "IN_TRANSIT",
                quantity: data.quantity,
                reason: data.reason?.trim() || "Entrega operativa a Producción",
                notes: data.notes?.trim() || null,
                occurredAt: data.occurredAt,
                actorId: data.actorId,
              },
              {
                type: "TRANSFERRED",
                fromAreaId: data.warehouseAreaId,
                toAreaId: data.productionAreaId,
                fromStatus: "AVAILABLE",
                toStatus: "IN_TRANSIT",
                quantity: data.quantity,
                // YF-003: vínculo trazable custodia ↔ movimiento de entrega (Kardex, cancelación y reconciliación).
                reason: `${data.reason?.trim() || "Entrega operativa a Producción"} · movimiento ${movement.folio}`,
                notes: data.notes?.trim() || null,
                occurredAt: data.occurredAt,
                actorId: data.actorId,
              },
            ],
          },
        },
        include: {
          item: true,
          custodianArea: true,
          nextActionArea: true,
          events: {
            orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
          },
        },
      });

      return { movement, custody, availableBefore: available.toNumber() };
}

export async function listActiveCustodiesByItem(itemId: string) {
  return db.inventoryCustody.findMany({
    where: {
      itemId,
      closedAt: null,
      status: { not: "CLOSED" },
    },
    include: {
      location: {
        include: { warehouse: true },
      },
      custodianArea: true,
      nextActionArea: true,
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      events: {
        include: {
          fromArea: true,
          toArea: true,
          actor: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      },
    },
    orderBy: [{ enteredAt: "desc" }, { createdAt: "desc" }],
  });
}


export class InvalidCustodyReceptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCustodyReceptionError";
  }
}

export async function listProductionCustodiesInTransit() {
  return db.inventoryCustody.findMany({
    where: {
      closedAt: null,
      status: "IN_TRANSIT",
      custodianArea: {
        code: "PRODUCCION",
        active: true,
      },
    },
    include: {
      item: true,
      custodianArea: true,
      nextActionArea: true,
      createdBy: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: [{ enteredAt: "asc" }, { createdAt: "asc" }],
  });
}

export async function receiveProductionCustody(data: ReceiveProductionCustodyData) {
  return db.$transaction(tx => receiveProductionCustodyInTransaction(tx, data), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export type ReceiveProductionCustodyData = {
  custodyId: string;
  receivedQuantity: Prisma.Decimal | number;
  actorId: string;
  notes?: string | null;
  occurredAt: Date;
};

/** YF-003: recepción de Producción exactamente una vez por Idempotency-Key (doble clic, reintento o dos pestañas). */
export async function receiveProductionCustodyOnce<R extends Record<string, unknown>>(
  data: ReceiveProductionCustodyData,
  operation: { idempotencyKey: string; payload: Record<string, unknown> },
  toResponse: (custody: Awaited<ReturnType<typeof receiveProductionCustodyInTransaction>>) => R,
) {
  return runStockOperationOnce({
    kind: "PRODUCTION_RECEIPT", actorId: data.actorId, idempotencyKey: operation.idempotencyKey, payload: operation.payload,
    lockKeys: [custodyLockKey(data.custodyId)], occurredAt: data.occurredAt,
  }, async tx => toResponse(await receiveProductionCustodyInTransaction(tx, data)));
}

/** Bloquea la custodia (bloqueo consultivo + fila) para que recepción, consumo y devolución nunca se crucen. */
async function lockCustody(tx: Prisma.TransactionClient, custodyId: string) {
  await lockWarehouseKeys(tx, [custodyLockKey(custodyId)]);
  await tx.$queryRaw`SELECT id FROM "InventoryCustody" WHERE id = ${custodyId} FOR UPDATE`;
}

function toDecimal(value: Prisma.Decimal | number) {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

async function receiveProductionCustodyInTransaction(tx: Prisma.TransactionClient, data: ReceiveProductionCustodyData) {
  await lockCustody(tx, data.custodyId);
  const custody = await tx.inventoryCustody.findUnique({
    where: { id: data.custodyId },
    include: { item: true, custodianArea: true, nextActionArea: true },
  });
  if (!custody) throw new InvalidCustodyReceptionError("La custodia solicitada no existe.");
  if (custody.closedAt || custody.status !== "IN_TRANSIT") {
    throw new InvalidCustodyReceptionError("Esta entrega ya no se encuentra pendiente de recepción.");
  }
  if (custody.custodianArea.code !== "PRODUCCION") throw new InvalidCustodyReceptionError("Esta custodia no corresponde a Producción.");
  const received = toDecimal(data.receivedQuantity);
  if (!received.isFinite() || !received.greaterThan(0) || received.decimalPlaces() > 3) {
    throw new InvalidCustodyReceptionError("La cantidad recibida debe ser mayor que cero y tener máximo tres decimales.");
  }
  if (!received.equals(custody.quantity)) {
    throw new InvalidCustodyReceptionError(
      `La recepción no puede cerrarse con diferencia. Almacén entregó ${custody.quantity.toString()} ${custody.unit} y Producción declaró ${received.toString()} ${custody.unit}. La diferencia debe investigarse antes de aceptar la custodia.`,
    );
  }
  const updated = await tx.inventoryCustody.updateMany({
    where: { id: custody.id, status: "IN_TRANSIT", closedAt: null },
    data: { status: "AVAILABLE", enteredAt: data.occurredAt },
  });
  if (updated.count !== 1) {
    throw new InvalidCustodyReceptionError("La custodia cambió mientras se procesaba la recepción. Actualiza la pantalla e inténtalo nuevamente.");
  }
  await tx.inventoryCustodyEvent.create({
    data: {
      custodyId: custody.id, type: "RECEIVED", fromAreaId: custody.custodianAreaId, toAreaId: custody.custodianAreaId,
      fromStatus: "IN_TRANSIT", toStatus: "AVAILABLE", quantity: received, reason: "Recepción confirmada por Producción",
      notes: data.notes?.trim() || null, occurredAt: data.occurredAt, actorId: data.actorId,
    },
  });
  return tx.inventoryCustody.findUniqueOrThrow({
    where: { id: custody.id },
    include: {
      item: true, custodianArea: true, nextActionArea: true,
      createdBy: { select: { id: true, name: true, email: true } },
      events: { include: { actor: { select: { id: true, name: true, email: true } } }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }] },
    },
  });
}

export class InvalidProductionCustodyOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProductionCustodyOperationError";
  }
}

export async function listProductionAvailableCustodies() {
  return db.inventoryCustody.findMany({
    where: {
      closedAt: null,
      status: "AVAILABLE",
      custodianArea: { code: "PRODUCCION", active: true },
    },
    include: {
      item: true,
      custodianArea: true,
      nextActionArea: true,
      createdBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ enteredAt: "asc" }, { createdAt: "asc" }],
  });
}


export async function consumeProductionCustody(data: {
  custodyId: string;
  quantity: number;
  referenceNumber: string;
  notes?: string | null;
  actorId: string;
  occurredAt: Date;
  operationKey: string;
  operationPayloadHash: string;
}) {
  const normalizedReference = data.referenceNumber.trim();
  const normalizedNotes = data.notes?.trim() || null;
  const requestHash = payloadHash({
    kind: "CONSUME_PRODUCTION_CUSTODY",
    actorId: data.actorId,
    custodyId: data.custodyId,
    payload: { quantity: data.quantity, referenceNumber: normalizedReference, notes: normalizedNotes },
  });
  if (data.operationPayloadHash !== requestHash) {
    throw new InvalidProductionCustodyOperationError("La clave de idempotencia ya fue usada con un payload distinto.");
  }

  const readCompletedOperation = async () => {
    const previous = await db.inventoryCustodyOperation.findUnique({
      where: { operationKey: data.operationKey },
      select: { operationPayloadHash: true, responseBody: true },
    });
    if (!previous) return null;
    if (previous.operationPayloadHash !== requestHash) {
      throw new InvalidProductionCustodyOperationError("La clave de idempotencia ya fue usada con un payload distinto.");
    }
    return (previous.responseBody as Record<string, unknown>) ?? { duplicate: true, idempotent: true };
  };

  const previous = await readCompletedOperation();
  if (previous) return previous;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        // YF-003: el mismo bloqueo que recepción y devolución; consumo y devolución nunca toman la misma cantidad.
        await lockCustody(tx, data.custodyId);
        const again = await tx.inventoryCustodyOperation.findUnique({ where: { operationKey: data.operationKey }, select: { operationPayloadHash: true, responseBody: true } });
        if (again) {
          if (again.operationPayloadHash !== requestHash) throw new InvalidProductionCustodyOperationError("La clave de idempotencia ya fue usada con un payload distinto.");
          return (again.responseBody as Record<string, unknown>) ?? { duplicate: true, idempotent: true };
        }
        const custody = await tx.inventoryCustody.findUnique({
          where: { id: data.custodyId },
          include: { item: true, custodianArea: true, nextActionArea: true },
        });

        if (!custody || custody.closedAt || custody.status !== "AVAILABLE") {
          throw new InvalidProductionCustodyOperationError("La custodia ya no está disponible para consumo.");
        }
        if (custody.custodianArea.code !== "PRODUCCION") {
          throw new InvalidProductionCustodyOperationError("La custodia no corresponde a Producción.");
        }
        const consumed = Number.isFinite(data.quantity) ? new Prisma.Decimal(data.quantity) : null;
        if (!consumed || !consumed.greaterThan(0) || consumed.decimalPlaces() > 3) {
          throw new InvalidProductionCustodyOperationError("La cantidad consumida debe ser mayor que cero y tener máximo tres decimales.");
        }
        if (!normalizedReference) {
          throw new InvalidProductionCustodyOperationError("La orden o referencia de producción es obligatoria.");
        }
        if (consumed.greaterThan(custody.quantity)) {
          throw new InvalidProductionCustodyOperationError(
            `No puedes consumir ${consumed.toString()} ${custody.unit}. La custodia disponible es ${custody.quantity.toString()} ${custody.unit}.`,
          );
        }

        // YF-003: aritmética decimal exacta (antes se usaba punto flotante: 0.3 - 0.1 - 0.2 no cerraba la custodia).
        const remaining = custody.quantity.minus(consumed);
        const closes = remaining.isZero();
        const updated = await tx.inventoryCustody.updateMany({
          where: { id: custody.id, status: "AVAILABLE", closedAt: null, quantity: custody.quantity },
          data: {
            quantity: remaining,
            status: closes ? "CLOSED" : "AVAILABLE",
            closedAt: closes ? data.occurredAt : null,
            referenceType: "ORDEN_PRODUCCION",
            referenceNumber: normalizedReference,
            enteredAt: data.occurredAt,
          },
        });
        if (updated.count !== 1) {
          throw new InvalidProductionCustodyOperationError("La custodia cambió durante el consumo. Actualiza e inténtalo nuevamente.");
        }

        await tx.inventoryCustodyEvent.create({
          data: {
            custodyId: custody.id, type: "CONSUMED", fromAreaId: custody.custodianAreaId, toAreaId: custody.custodianAreaId,
            fromStatus: "AVAILABLE", toStatus: closes ? "CLOSED" : "AVAILABLE", quantity: consumed,
            reason: `Consumo de material en Producción · ${normalizedReference}`, notes: normalizedNotes,
            occurredAt: data.occurredAt, actorId: data.actorId,
          },
        });
        if (closes) {
          await tx.inventoryCustodyEvent.create({
            data: {
              custodyId: custody.id, type: "CLOSED", fromAreaId: custody.custodianAreaId, toAreaId: custody.custodianAreaId,
              fromStatus: "AVAILABLE", toStatus: "CLOSED", quantity: new Prisma.Decimal(0),
              reason: "Custodia cerrada por consumo total", occurredAt: data.occurredAt, actorId: data.actorId,
            },
          });
        }

        const response = JSON.parse(JSON.stringify({
          consumed: consumed.toNumber(),
          remaining: remaining.toNumber(),
          unit: custody.unit,
          folio: custody.folio,
          item: custody.item,
          duplicate: false,
          idempotent: false,
        })) as Prisma.InputJsonObject;

        await tx.inventoryCustodyOperation.create({
          data: {
            operationKey: data.operationKey, operationPayloadHash: requestHash, custodyId: data.custodyId,
            kind: "CONSUME_PRODUCTION_CUSTODY", actorId: data.actorId,
            requestBody: { custodyId: data.custodyId, quantity: data.quantity, referenceNumber: normalizedReference, notes: normalizedNotes },
            responseBody: response, processedAt: data.occurredAt,
          },
        });
        return response;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (isUniqueConflict(error) || isSerializationConflict(error)) {
        const completed = await readCompletedOperation();
        if (completed) return completed;
        if (isSerializationConflict(error) && attempt < 2) continue;
      }
      throw error;
    }
  }
}

export type RequestProductionReturnData = {
  custodyId: string;
  /** Cantidad a devolver; si se omite se devuelve todo el saldo de la custodia. */
  quantity?: Prisma.Decimal | null;
  /** Folio de la custodia nueva cuando la devolución es parcial. */
  returnFolio?: string;
  notes?: string | null;
  actorId: string;
  occurredAt: Date;
};

export async function requestProductionReturn(data: RequestProductionReturnData) {
  return db.$transaction(tx => requestProductionReturnInTransaction(tx, data), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

/** YF-003: solicitud de devolución exactamente una vez por Idempotency-Key. */
export async function requestProductionReturnOnce<R extends Record<string, unknown>>(
  data: RequestProductionReturnData,
  operation: { idempotencyKey: string; payload: Record<string, unknown> },
  toResponse: (result: Awaited<ReturnType<typeof requestProductionReturnInTransaction>>) => R,
) {
  return runStockOperationOnce({
    kind: "RETURN_REQUEST", actorId: data.actorId, idempotencyKey: operation.idempotencyKey, payload: operation.payload,
    lockKeys: [custodyLockKey(data.custodyId)], occurredAt: data.occurredAt,
  }, async tx => toResponse(await requestProductionReturnInTransaction(tx, data)));
}

/**
 * Devolución total: la custodia pasa a RETURN_IN_TRANSIT. Devolución parcial: la cantidad devuelta se separa en una custodia
 * nueva (RETURN_IN_TRANSIT, referencia a la original) y la original conserva el resto disponible en Producción. La misma
 * cantidad nunca queda a la vez disponible para consumo y en devolución.
 */
async function requestProductionReturnInTransaction(tx: Prisma.TransactionClient, data: RequestProductionReturnData) {
  await lockCustody(tx, data.custodyId);
  const custody = await tx.inventoryCustody.findUnique({ where: { id: data.custodyId }, include: { item: true, custodianArea: true } });
  if (!custody || custody.closedAt || custody.status !== "AVAILABLE") {
    throw new InvalidProductionCustodyOperationError("La custodia ya no está disponible para devolución.");
  }
  if (custody.custodianArea.code !== "PRODUCCION" || !custody.quantity.greaterThan(0)) {
    throw new InvalidProductionCustodyOperationError("La custodia no tiene material disponible en Producción.");
  }
  const warehouseArea = await tx.operationalArea.findUnique({ where: { code: "ALMACEN" } });
  if (!warehouseArea?.active) throw new InvalidProductionCustodyOperationError("El área ALMACEN no está disponible.");
  const quantity = data.quantity ?? custody.quantity;
  if (!quantity.greaterThan(0) || quantity.decimalPlaces() > 3) {
    throw new InvalidProductionCustodyOperationError("La cantidad a devolver debe ser mayor que cero y tener máximo tres decimales.");
  }
  if (quantity.greaterThan(custody.quantity)) {
    throw new InvalidProductionCustodyOperationError(
      `No puedes devolver ${quantity.toString()} ${custody.unit}. La custodia disponible es ${custody.quantity.toString()} ${custody.unit}.`,
    );
  }
  const notes = data.notes?.trim() || null;

  if (quantity.equals(custody.quantity)) {
    const updated = await tx.inventoryCustody.updateMany({
      where: { id: custody.id, status: "AVAILABLE", closedAt: null, quantity: custody.quantity },
      data: { status: "RETURN_IN_TRANSIT", nextActionAreaId: warehouseArea.id, enteredAt: data.occurredAt },
    });
    if (updated.count !== 1) throw new InvalidProductionCustodyOperationError("La custodia cambió durante la devolución. Actualiza e inténtalo nuevamente.");
    await tx.inventoryCustodyEvent.create({ data: {
      custodyId: custody.id, type: "RETURN_REQUESTED", fromAreaId: custody.custodianAreaId, toAreaId: warehouseArea.id,
      fromStatus: "AVAILABLE", toStatus: "RETURN_IN_TRANSIT", quantity, reason: "Sobrante enviado para devolución a Almacén",
      notes, occurredAt: data.occurredAt, actorId: data.actorId,
    } });
    return { folio: custody.folio, custodyId: custody.id, quantity: quantity.toNumber(), remainingInProduction: 0, unit: custody.unit, item: custody.item, partial: false };
  }

  if (!data.returnFolio) throw new Error("La devolución parcial requiere el folio de la custodia de devolución.");
  const remaining = custody.quantity.minus(quantity);
  const updated = await tx.inventoryCustody.updateMany({
    where: { id: custody.id, status: "AVAILABLE", closedAt: null, quantity: custody.quantity },
    data: { quantity: remaining },
  });
  if (updated.count !== 1) throw new InvalidProductionCustodyOperationError("La custodia cambió durante la devolución. Actualiza e inténtalo nuevamente.");
  const reason = `Devolución parcial a Almacén desde ${custody.folio}`;
  await tx.inventoryCustodyEvent.create({ data: {
    custodyId: custody.id, type: "RETURN_REQUESTED", fromAreaId: custody.custodianAreaId, toAreaId: warehouseArea.id,
    fromStatus: "AVAILABLE", toStatus: "AVAILABLE", quantity, reason: `${reason}; continúa disponible ${remaining.toString()} ${custody.unit}`,
    notes, occurredAt: data.occurredAt, actorId: data.actorId,
  } });
  const child = await tx.inventoryCustody.create({ data: {
    folio: data.returnFolio, itemId: custody.itemId, quantity, unit: custody.unit, locationId: null,
    custodianAreaId: custody.custodianAreaId, nextActionAreaId: warehouseArea.id, status: "RETURN_IN_TRANSIT",
    reason, referenceType: "CUSTODIA_ORIGEN", referenceNumber: custody.folio, notes, enteredAt: data.occurredAt, createdById: data.actorId,
    parentCustodyId: custody.id,
    events: { create: [{
      type: "RETURN_REQUESTED", fromAreaId: custody.custodianAreaId, toAreaId: warehouseArea.id, fromStatus: "AVAILABLE",
      toStatus: "RETURN_IN_TRANSIT", quantity, reason, notes, occurredAt: data.occurredAt, actorId: data.actorId,
    }] },
  } });
  return { folio: child.folio, custodyId: child.id, sourceFolio: custody.folio, quantity: quantity.toNumber(), remainingInProduction: remaining.toNumber(), unit: custody.unit, item: custody.item, partial: true };
}

export async function listWarehouseReturnsInTransit() {
  return db.inventoryCustody.findMany({
    where: { closedAt: null, status: "RETURN_IN_TRANSIT", custodianArea: { code: "PRODUCCION" } },
    include: { item: true, custodianArea: true, nextActionArea: true, createdBy: { select: { id: true, name: true, email: true } } },
    orderBy: [{ enteredAt: "asc" }, { createdAt: "asc" }],
  });
}

export type ReceiveWarehouseReturnData = {
  custodyId: string;
  movementFolio: string;
  receivedQuantity: Prisma.Decimal | number;
  destinationLocationId: string;
  notes?: string | null;
  actorId: string;
  occurredAt: Date;
};

export async function receiveWarehouseReturn(data: ReceiveWarehouseReturnData) {
  return db.$transaction(tx => receiveWarehouseReturnInTransaction(tx, data), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

/** YF-003: recepción de devolución exactamente una vez por Idempotency-Key (un solo movimiento de regreso a Almacén). */
export async function receiveWarehouseReturnOnce<R extends Record<string, unknown>>(
  data: ReceiveWarehouseReturnData,
  operation: { idempotencyKey: string; payload: Record<string, unknown> },
  toResponse: (result: Awaited<ReturnType<typeof receiveWarehouseReturnInTransaction>>) => R,
) {
  return runStockOperationOnce({
    kind: "RETURN_RECEIPT", actorId: data.actorId, idempotencyKey: operation.idempotencyKey, payload: operation.payload,
    lockKeys: [custodyLockKey(data.custodyId)], occurredAt: data.occurredAt,
  }, async tx => toResponse(await receiveWarehouseReturnInTransaction(tx, data)));
}

async function receiveWarehouseReturnInTransaction(tx: Prisma.TransactionClient, data: ReceiveWarehouseReturnData) {
  await lockCustody(tx, data.custodyId);
  const custody = await tx.inventoryCustody.findUnique({ where: { id: data.custodyId }, include: { item: true, custodianArea: true } });
  if (!custody || custody.closedAt || custody.status !== "RETURN_IN_TRANSIT") {
    throw new InvalidProductionCustodyOperationError("Esta devolución ya no está pendiente de recepción.");
  }
  const received = toDecimal(data.receivedQuantity);
  if (!received.isFinite() || !received.equals(custody.quantity)) {
    throw new InvalidProductionCustodyOperationError(
      `La devolución no puede cerrarse con diferencia. Producción entrega ${custody.quantity.toString()} ${custody.unit}. La cantidad física debe coincidir antes de recibir.`,
    );
  }
  const destination = await tx.warehouseLocation.findUnique({ where: { id: data.destinationLocationId }, include: { warehouse: true } });
  if (!destination?.active || !destination.warehouse.active) throw new InvalidProductionCustodyOperationError("La ubicación destino no está activa.");
  await assertActiveCatalog(tx, custody.itemId, [destination.id]);
  const warehouseArea = await tx.operationalArea.findUnique({ where: { code: "ALMACEN" } });
  if (!warehouseArea?.active) throw new InvalidProductionCustodyOperationError("El área ALMACEN no está disponible.");
  // Mismo bloqueo de existencias que conteos y ajustes de la ubicación destino.
  await lockWarehouseKeys(tx, [stockLockKey(custody.itemId, destination.id)]);

  const movement = await tx.inventoryMovement.create({ data: {
    folio: data.movementFolio, itemId: custody.itemId, type: "OPERATIONAL_RETURN", quantity: custody.quantity, unit: custody.unit,
    originLocationId: null, destinationLocationId: destination.id, referenceType: "CUSTODIA", referenceNumber: custody.folio,
    notes: data.notes?.trim() || "Devolución de sobrante desde Producción", occurredAt: data.occurredAt, actorId: data.actorId,
  } });
  const updated = await tx.inventoryCustody.updateMany({
    where: { id: custody.id, status: "RETURN_IN_TRANSIT", closedAt: null },
    data: { quantity: new Prisma.Decimal(0), status: "CLOSED", nextActionAreaId: warehouseArea.id, closedAt: data.occurredAt, enteredAt: data.occurredAt,
      closingMovementId: movement.id },
  });
  if (updated.count !== 1) throw new InvalidProductionCustodyOperationError("La custodia cambió durante la recepción. Actualiza e inténtalo nuevamente.");
  await tx.inventoryCustodyEvent.createMany({ data: [
    {
      custodyId: custody.id, type: "RETURNED", fromAreaId: custody.custodianAreaId, toAreaId: warehouseArea.id,
      fromStatus: "RETURN_IN_TRANSIT", toStatus: "CLOSED", quantity: custody.quantity,
      reason: `Devolución recibida en ${destination.code} (movimiento ${movement.folio})`, notes: data.notes?.trim() || null,
      occurredAt: data.occurredAt, actorId: data.actorId,
    },
    {
      custodyId: custody.id, type: "CLOSED", fromAreaId: custody.custodianAreaId, toAreaId: warehouseArea.id,
      fromStatus: "RETURN_IN_TRANSIT", toStatus: "CLOSED", quantity: new Prisma.Decimal(0),
      reason: "Custodia cerrada por devolución a Almacén", notes: null, occurredAt: data.occurredAt, actorId: data.actorId,
    },
  ] });
  return { movement, returnedQuantity: custody.quantity.toNumber(), unit: custody.unit, custodyFolio: custody.folio, item: custody.item, destination };
}

export type CancelHandoffData = { custodyId: string; movementFolio: string; reason: string; actorId: string; occurredAt: Date };

/**
 * YF-003 · Cancelación controlada de una entrega a Producción que aún NO fue recibida (IN_TRANSIT): registra un movimiento
 * OPERATIONAL_RETURN a la ubicación original (referencia al folio de la entrega) y cierra la custodia con evento trazable.
 * No borra ni modifica el movimiento original.
 */
export async function cancelOperationalHandoffInTransaction(tx: Prisma.TransactionClient, data: CancelHandoffData) {
  await lockCustody(tx, data.custodyId);
  const custody = await tx.inventoryCustody.findUnique({ where: { id: data.custodyId }, include: { item: true } });
  if (!custody || custody.closedAt || custody.status !== "IN_TRANSIT") {
    throw new InvalidProductionCustodyOperationError("Solo puede cancelarse una entrega que aún no fue recibida por Producción.");
  }
  // YF-003 V2: solo el vínculo explícito (sourceMovementId). Una custodia histórica sin vínculo no se cancela por coincidencia:
  // primero se vincula con el diagnóstico (scripts/warehouse-custody-link.cjs), que solo acepta coincidencias inequívocas.
  const source = custody.sourceMovementId ? await tx.inventoryMovement.findUnique({ where: { id: custody.sourceMovementId } }) : null;
  if (!source || source.type !== "OPERATIONAL_HANDOFF" || !source.originLocationId) throw new InvalidProductionCustodyOperationError("La custodia no tiene vinculado su movimiento de entrega; ejecuta el diagnóstico de vínculos antes de cancelarla.");
  await assertActiveCatalog(tx, custody.itemId, [source.originLocationId]);
  await lockWarehouseKeys(tx, [stockLockKey(custody.itemId, source.originLocationId)]);
  const warehouseArea = await tx.operationalArea.findUnique({ where: { code: "ALMACEN" } });
  if (!warehouseArea?.active) throw new InvalidProductionCustodyOperationError("El área ALMACEN no está disponible.");
  const movement = await tx.inventoryMovement.create({ data: {
    folio: data.movementFolio, itemId: custody.itemId, type: "OPERATIONAL_RETURN", quantity: custody.quantity, unit: custody.unit,
    originLocationId: null, destinationLocationId: source.originLocationId, referenceType: "REVERSO", referenceNumber: source.folio,
    notes: `Cancelación de entrega ${custody.folio}: ${data.reason}`, occurredAt: data.occurredAt, actorId: data.actorId,
  } });
  const updated = await tx.inventoryCustody.updateMany({
    where: { id: custody.id, status: "IN_TRANSIT", closedAt: null },
    data: { quantity: new Prisma.Decimal(0), status: "CLOSED", nextActionAreaId: warehouseArea.id, closedAt: data.occurredAt, closingMovementId: movement.id },
  });
  if (updated.count !== 1) throw new InvalidProductionCustodyOperationError("La custodia cambió durante la cancelación. Actualiza e inténtalo nuevamente.");
  await tx.inventoryCustodyEvent.create({ data: {
    custodyId: custody.id, type: "CLOSED", fromAreaId: custody.custodianAreaId, toAreaId: warehouseArea.id, fromStatus: "IN_TRANSIT",
    toStatus: "CLOSED", quantity: custody.quantity, reason: `Entrega cancelada antes de su recepción (reverso ${movement.folio})`,
    notes: data.reason, occurredAt: data.occurredAt, actorId: data.actorId,
  } });
  return { movement, custodyFolio: custody.folio, originalMovementFolio: source.folio, quantity: custody.quantity.toNumber(), unit: custody.unit };
}
