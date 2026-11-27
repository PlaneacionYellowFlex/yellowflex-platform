import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { validateInventoryMovement } from "@/engines/warehouse";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { missingIdempotencyKey, requireIdempotencyKey, warehouseApiError } from "@/lib/warehouse/api-error";
import { InvalidWarehouseQuantityError, parseWarehouseQuantity } from "@/lib/warehouse-quantity";
import {
  createOperationalHandoffOnce,
  InsufficientWarehouseStockError,
} from "@/repositories/warehouse-custody.repository";
import {
  getInventoryBalancesByItem,
  getInventoryItemById,
  getWarehouseLocationById,
  listInventoryItems,
} from "@/repositories/warehouse.repository";
import { db } from "@/lib/db";

function movementFolio(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const token = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  return `IM-${y}${m}${d}-${token}`;
}

function custodyFolio(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const token = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  return `CUS-${y}${m}${d}-${token}`;
}

export async function GET(request?: Request) {
  try {
    await requireWarehouseCapability("operate");

    // YF-003 V2: los saldos se piden por artículo (?itemId=) en lugar de descargar todo el inventario artículo-ubicación.
    const itemId = request?.url ? new URL(request.url).searchParams.get("itemId") : null;
    const [items, balances] = await Promise.all([
      listInventoryItems(),
      itemId ? getInventoryBalancesByItem(itemId) : Promise.resolve([]),
    ]);

    return NextResponse.json({
      items: items
        .filter((item) => item.active)
        .map((item) => ({
          id: item.id,
          code: item.code,
          description: item.description,
          baseUnit: item.baseUnit,
        })),
      balances: balances
        .filter((balance) => balance.quantity > 0)
        .map((balance) => ({
          itemId: balance.itemId,
          locationId: balance.locationId,
          locationCode: balance.locationCode,
          locationName: balance.locationName,
          warehouseName: balance.warehouseName,
          quantity: balance.quantity,
          unit: balance.baseUnit,
        })),
    });
  } catch (error) {
    return warehouseApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    // Autorización antes de leer el cuerpo; la clave de idempotencia evita entregas duplicadas por doble clic o reintento.
    const user = await requireWarehouseCapability("operate");
    const idempotencyKey = requireIdempotencyKey(request);
    if (!idempotencyKey) return missingIdempotencyKey();
    const body = await request.json();

    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    const originLocationId =
      typeof body.originLocationId === "string"
        ? body.originLocationId.trim()
        : "";
    let quantity;
    try {
      quantity = parseWarehouseQuantity(body.quantity);
    } catch (error) {
      if (error instanceof InvalidWarehouseQuantityError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    if (!itemId || !originLocationId) {
      return NextResponse.json(
        { error: "Artículo y ubicación de origen son obligatorios." },
        { status: 400 },
      );
    }

    const validation = validateInventoryMovement({
      type: "OPERATIONAL_HANDOFF",
      quantity: quantity.toNumber(),
      originLocationId,
      destinationLocationId: null,
    });

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const [item, originLocation, warehouseArea, productionArea] =
      await Promise.all([
        getInventoryItemById(itemId),
        getWarehouseLocationById(originLocationId),
        db.operationalArea.findUnique({ where: { code: "ALMACEN" } }),
        db.operationalArea.findUnique({ where: { code: "PRODUCCION" } }),
      ]);

    if (!item?.active) {
      return NextResponse.json(
        { error: "El artículo no existe o está inactivo." },
        { status: 400 },
      );
    }

    if (!originLocation?.active || !originLocation.warehouse.active) {
      return NextResponse.json(
        { error: "La ubicación de origen no existe o está inactiva." },
        { status: 400 },
      );
    }

    if (!warehouseArea?.active || !productionArea?.active) {
      return NextResponse.json(
        {
          error:
            "Las áreas operativas ALMACEN y PRODUCCION deben existir y estar activas.",
        },
        { status: 500 },
      );
    }

    const occurredAt = new Date();

    const referenceType = typeof body.referenceType === "string" ? body.referenceType.trim() || null : null;
    const referenceNumber = typeof body.referenceNumber === "string" ? body.referenceNumber.trim() || null : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
    const { response, replayed } = await createOperationalHandoffOnce({
      movementFolio: movementFolio(occurredAt),
      custodyFolio: custodyFolio(occurredAt),
      itemId: item.id,
      quantity,
      unit: item.baseUnit,
      originLocationId: originLocation.id,
      warehouseAreaId: warehouseArea.id,
      productionAreaId: productionArea.id,
      referenceType,
      referenceNumber,
      reason: "Entrega operativa de Almacén a Producción",
      notes,
      occurredAt,
      actorId: user.id,
    }, {
      idempotencyKey,
      payload: { itemId: item.id, originLocationId: originLocation.id, quantity: quantity.toFixed(3), referenceType, referenceNumber, notes },
    }, result => ({
      movement: {
        id: result.movement.id,
        folio: result.movement.folio,
      },
      custody: {
        id: result.custody.id,
        folio: result.custody.folio,
        status: result.custody.status,
        custodianArea: result.custody.custodianArea.name,
      },
      item: {
        id: item.id,
        code: item.code,
        description: item.description,
        baseUnit: item.baseUnit,
      },
      origin: {
        id: originLocation.id,
        code: originLocation.code,
        warehouseName: originLocation.warehouse.name,
      },
      quantity: quantity.toNumber(),
      availableBefore: result.availableBefore,
      availableAfter: result.availableBefore - quantity.toNumber(),
    }));

    return NextResponse.json({ ...response, replayed }, { status: replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof InsufficientWarehouseStockError) {
      return NextResponse.json(
        {
          error: error.message,
          available: error.available,
          requested: error.requested,
        },
        { status: 409 },
      );
    }

    return warehouseApiError(error);
  }
}
