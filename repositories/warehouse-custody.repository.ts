import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { isSerializationConflict, isUniqueConflict, payloadHash } from "@/lib/warehouse-idempotency";

export type CreateOperationalHandoffData = {
  movementFolio: string;
  custodyFolio: string;
  itemId: string;
  quantity: number;
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
    async (tx) => {
      const [incoming, outgoing] = await Promise.all([
        tx.inventoryMovement.aggregate({
          where: {
            itemId: data.itemId,
            destinationLocationId: data.originLocationId,
          },
          _sum: { quantity: true },
        }),
        tx.inventoryMovement.aggregate({
          where: {
            itemId: data.itemId,
            originLocationId: data.originLocationId,
          },
          _sum: { quantity: true },
        }),
      ]);

      const available =
        (incoming._sum.quantity?.toNumber() ?? 0) -
        (outgoing._sum.quantity?.toNumber() ?? 0);

      if (available < data.quantity) {
        throw new InsufficientWarehouseStockError(available, data.quantity);
      }

      const movement = await tx.inventoryMovement.create({
        data: {
          folio: data.movementFolio,
          itemId: data.itemId,
          type: "OPERATIONAL_HANDOFF",
          quantity: new Prisma.Decimal(data.quantity),
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
          quantity: new Prisma.Decimal(data.quantity),
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
          events: {
            create: [
              {
                type: "CREATED",
                fromAreaId: data.warehouseAreaId,
                toAreaId: data.productionAreaId,
                fromStatus: "AVAILABLE",
                toStatus: "IN_TRANSIT",
                quantity: new Prisma.Decimal(data.quantity),
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
                quantity: new Prisma.Decimal(data.quantity),
                reason: data.reason?.trim() || "Entrega operativa a Producción",
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

      return { movement, custody, availableBefore: available };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
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

export async function receiveProductionCustody(data: {
  custodyId: string;
  receivedQuantity: number;
  actorId: string;
  notes?: string | null;
  occurredAt: Date;
}) {
  return db.$transaction(
    async (tx) => {
      const custody = await tx.inventoryCustody.findUnique({
        where: { id: data.custodyId },
        include: {
          item: true,
          custodianArea: true,
          nextActionArea: true,
        },
      });

      if (!custody) {
        throw new InvalidCustodyReceptionError(
          "La custodia solicitada no existe.",
        );
      }

      if (custody.closedAt || custody.status !== "IN_TRANSIT") {
        throw new InvalidCustodyReceptionError(
          "Esta entrega ya no se encuentra pendiente de recepción.",
        );
      }

      if (custody.custodianArea.code !== "PRODUCCION") {
        throw new InvalidCustodyReceptionError(
          "Esta custodia no corresponde a Producción.",
        );
      }

      const expectedQuantity = custody.quantity.toNumber();

      if (
        !Number.isFinite(data.receivedQuantity) ||
        data.receivedQuantity <= 0
      ) {
        throw new InvalidCustodyReceptionError(
          "La cantidad recibida debe ser mayor que cero.",
        );
      }

      if (data.receivedQuantity !== expectedQuantity) {
        throw new InvalidCustodyReceptionError(
          `La recepción no puede cerrarse con diferencia. Almacén entregó ${expectedQuantity} ${custody.unit} y Producción declaró ${data.receivedQuantity} ${custody.unit}. La diferencia debe investigarse antes de aceptar la custodia.`,
        );
      }

      const updated = await tx.inventoryCustody.updateMany({
        where: {
          id: custody.id,
          status: "IN_TRANSIT",
          closedAt: null,
        },
        data: {
          status: "AVAILABLE",
          enteredAt: data.occurredAt,
        },
      });

      if (updated.count !== 1) {
        throw new InvalidCustodyReceptionError(
          "La custodia cambió mientras se procesaba la recepción. Actualiza la pantalla e inténtalo nuevamente.",
        );
      }

      await tx.inventoryCustodyEvent.create({
        data: {
          custodyId: custody.id,
          type: "RECEIVED",
          fromAreaId: custody.custodianAreaId,
          toAreaId: custody.custodianAreaId,
          fromStatus: "IN_TRANSIT",
          toStatus: "AVAILABLE",
          quantity: new Prisma.Decimal(data.receivedQuantity),
          reason: "Recepción confirmada por Producción",
          notes: data.notes?.trim() || null,
          occurredAt: data.occurredAt,
          actorId: data.actorId,
        },
      });

      return tx.inventoryCustody.findUniqueOrThrow({
        where: { id: custody.id },
        include: {
          item: true,
          custodianArea: true,
          nextActionArea: true,
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          events: {
            include: {
              actor: {
                select: { id: true, name: true, email: true },
              },
            },
            orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
          },
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
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
    payload: {
      quantity: data.quantity,
      referenceNumber: normalizedReference,
      notes: normalizedNotes,
    },
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
        if (!Number.isFinite(data.quantity) || data.quantity <= 0 || !Number.isInteger(data.quantity * 1000)) {
          throw new InvalidProductionCustodyOperationError("La cantidad consumida debe ser mayor que cero y tener máximo tres decimales.");
        }
        if (!normalizedReference) {
          throw new InvalidProductionCustodyOperationError("La orden o referencia de producción es obligatoria.");
        }

        const available = custody.quantity.toNumber();
        if (data.quantity > available) {
          throw new InvalidProductionCustodyOperationError(
            `No puedes consumir ${data.quantity} ${custody.unit}. La custodia disponible es ${available} ${custody.unit}.`,
          );
        }

        const remaining = available - data.quantity;
        const updated = await tx.inventoryCustody.updateMany({
          where: { id: custody.id, status: "AVAILABLE", closedAt: null, quantity: custody.quantity },
          data: {
            quantity: new Prisma.Decimal(remaining),
            status: remaining === 0 ? "CLOSED" : "AVAILABLE",
            closedAt: remaining === 0 ? data.occurredAt : null,
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
            custodyId: custody.id,
            type: "CONSUMED",
            fromAreaId: custody.custodianAreaId,
            toAreaId: custody.custodianAreaId,
            fromStatus: "AVAILABLE",
            toStatus: remaining === 0 ? "CLOSED" : "AVAILABLE",
            quantity: new Prisma.Decimal(data.quantity),
            reason: `Consumo de material en Producción · ${normalizedReference}`,
            notes: normalizedNotes,
            occurredAt: data.occurredAt,
            actorId: data.actorId,
          },
        });

        if (remaining === 0) {
          await tx.inventoryCustodyEvent.create({
            data: {
              custodyId: custody.id,
              type: "CLOSED",
              fromAreaId: custody.custodianAreaId,
              toAreaId: custody.custodianAreaId,
              fromStatus: "AVAILABLE",
              toStatus: "CLOSED",
              quantity: new Prisma.Decimal(0),
              reason: "Custodia cerrada por consumo total",
              occurredAt: data.occurredAt,
              actorId: data.actorId,
            },
          });
        }

        const response = JSON.parse(JSON.stringify({
          consumed: data.quantity,
          remaining,
          unit: custody.unit,
          folio: custody.folio,
          item: custody.item,
          duplicate: false,
          idempotent: false,
        })) as Prisma.InputJsonObject;

        await tx.inventoryCustodyOperation.create({
          data: {
            operationKey: data.operationKey,
            operationPayloadHash: requestHash,
            custodyId: data.custodyId,
            kind: "CONSUME_PRODUCTION_CUSTODY",
            actorId: data.actorId,
            requestBody: {
              custodyId: data.custodyId,
              quantity: data.quantity,
              referenceNumber: normalizedReference,
              notes: normalizedNotes,
            },
            responseBody: response,
            processedAt: data.occurredAt,
          },
        });

        return response;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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

export async function requestProductionReturn(data: {
  custodyId: string;
  notes?: string | null;
  actorId: string;
  occurredAt: Date;
}) {
  return db.$transaction(async (tx) => {
    const custody = await tx.inventoryCustody.findUnique({
      where: { id: data.custodyId },
      include: { item: true, custodianArea: true },
    });
    if (!custody || custody.closedAt || custody.status !== "AVAILABLE") {
      throw new InvalidProductionCustodyOperationError("La custodia ya no está disponible para devolución.");
    }
    if (custody.custodianArea.code !== "PRODUCCION" || custody.quantity.toNumber() <= 0) {
      throw new InvalidProductionCustodyOperationError("La custodia no tiene material disponible en Producción.");
    }
    const warehouseArea = await tx.operationalArea.findUnique({ where: { code: "ALMACEN" } });
    if (!warehouseArea?.active) {
      throw new InvalidProductionCustodyOperationError("El área ALMACEN no está disponible.");
    }

    const updated = await tx.inventoryCustody.updateMany({
      where: { id: custody.id, status: "AVAILABLE", closedAt: null },
      data: { status: "RETURN_IN_TRANSIT", nextActionAreaId: warehouseArea.id, enteredAt: data.occurredAt },
    });
    if (updated.count !== 1) {
      throw new InvalidProductionCustodyOperationError("La custodia cambió durante la devolución. Actualiza e inténtalo nuevamente.");
    }

    await tx.inventoryCustodyEvent.create({
      data: {
        custodyId: custody.id,
        type: "RETURN_REQUESTED",
        fromAreaId: custody.custodianAreaId,
        toAreaId: warehouseArea.id,
        fromStatus: "AVAILABLE",
        toStatus: "RETURN_IN_TRANSIT",
        quantity: custody.quantity,
        reason: "Sobrante enviado para devolución a Almacén",
        notes: data.notes?.trim() || null,
        occurredAt: data.occurredAt,
        actorId: data.actorId,
      },
    });

    return { folio: custody.folio, quantity: custody.quantity.toNumber(), unit: custody.unit, item: custody.item };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function listWarehouseReturnsInTransit() {
  return db.inventoryCustody.findMany({
    where: { closedAt: null, status: "RETURN_IN_TRANSIT", custodianArea: { code: "PRODUCCION" } },
    include: { item: true, custodianArea: true, nextActionArea: true, createdBy: { select: { id: true, name: true, email: true } } },
    orderBy: [{ enteredAt: "asc" }, { createdAt: "asc" }],
  });
}

export async function receiveWarehouseReturn(data: {
  custodyId: string;
  movementFolio: string;
  receivedQuantity: number;
  destinationLocationId: string;
  notes?: string | null;
  actorId: string;
  occurredAt: Date;
}) {
  return db.$transaction(async (tx) => {
    const custody = await tx.inventoryCustody.findUnique({
      where: { id: data.custodyId },
      include: { item: true, custodianArea: true },
    });
    if (!custody || custody.closedAt || custody.status !== "RETURN_IN_TRANSIT") {
      throw new InvalidProductionCustodyOperationError("Esta devolución ya no está pendiente de recepción.");
    }
    const expected = custody.quantity.toNumber();
    if (!Number.isFinite(data.receivedQuantity) || data.receivedQuantity !== expected) {
      throw new InvalidProductionCustodyOperationError(
        `La devolución no puede cerrarse con diferencia. Producción entrega ${expected} ${custody.unit}. La cantidad física debe coincidir antes de recibir.`,
      );
    }
    const destination = await tx.warehouseLocation.findUnique({
      where: { id: data.destinationLocationId },
      include: { warehouse: true },
    });
    if (!destination?.active || !destination.warehouse.active) {
      throw new InvalidProductionCustodyOperationError("La ubicación destino no está activa.");
    }
    const warehouseArea = await tx.operationalArea.findUnique({ where: { code: "ALMACEN" } });
    if (!warehouseArea?.active) throw new InvalidProductionCustodyOperationError("El área ALMACEN no está disponible.");

    const movement = await tx.inventoryMovement.create({
      data: {
        folio: data.movementFolio,
        itemId: custody.itemId,
        type: "OPERATIONAL_RETURN",
        quantity: custody.quantity,
        unit: custody.unit,
        originLocationId: null,
        destinationLocationId: destination.id,
        referenceType: "CUSTODIA",
        referenceNumber: custody.folio,
        notes: data.notes?.trim() || "Devolución de sobrante desde Producción",
        occurredAt: data.occurredAt,
        actorId: data.actorId,
      },
    });

    const updated = await tx.inventoryCustody.updateMany({
      where: { id: custody.id, status: "RETURN_IN_TRANSIT", closedAt: null },
      data: { quantity: new Prisma.Decimal(0), status: "CLOSED", nextActionAreaId: warehouseArea.id, closedAt: data.occurredAt, enteredAt: data.occurredAt },
    });
    if (updated.count !== 1) throw new InvalidProductionCustodyOperationError("La custodia cambió durante la recepción. Actualiza e inténtalo nuevamente.");

    await tx.inventoryCustodyEvent.createMany({ data: [
      {
        custodyId: custody.id, type: "RETURNED", fromAreaId: custody.custodianAreaId, toAreaId: warehouseArea.id,
        fromStatus: "RETURN_IN_TRANSIT", toStatus: "CLOSED", quantity: custody.quantity,
        reason: `Devolución recibida en ${destination.code}`, notes: data.notes?.trim() || null,
        occurredAt: data.occurredAt, actorId: data.actorId,
      },
      {
        custodyId: custody.id, type: "CLOSED", fromAreaId: custody.custodianAreaId, toAreaId: warehouseArea.id,
        fromStatus: "RETURN_IN_TRANSIT", toStatus: "CLOSED", quantity: new Prisma.Decimal(0),
        reason: "Custodia cerrada por devolución a Almacén", notes: null,
        occurredAt: data.occurredAt, actorId: data.actorId,
      },
    ] });

    return { movement, returnedQuantity: expected, unit: custody.unit, custodyFolio: custody.folio, item: custody.item, destination };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
