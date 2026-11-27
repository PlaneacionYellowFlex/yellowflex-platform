import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { validateInventoryMovement } from "@/engines/warehouse";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { missingIdempotencyKey, requireIdempotencyKey, warehouseApiError } from "@/lib/warehouse/api-error";
import { parseWarehouseQuantity } from "@/lib/warehouse-quantity";
import {
  getInventoryItemById,
  getWarehouseLocationById,
  listInventoryItems,
  listWarehouses,
} from "@/repositories/warehouse.repository";
import { createExternalReceiptOnce } from "@/repositories/warehouse-movements.repository";

function createMovementFolio() {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");

  const unique = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();

  return `IM-${date}-${unique}`;
}

function cleanOptional(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

export async function GET() {
  try {
    await requireWarehouseCapability("operate");

    const [items, warehouses] = await Promise.all([
      listInventoryItems(),
      listWarehouses(),
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
      locations: warehouses
        .filter((warehouse) => warehouse.active)
        .flatMap((warehouse) =>
          warehouse.locations
            .filter((location) => location.active)
            .map((location) => ({
              id: location.id,
              code: location.code,
              name: location.name,
              warehouseId: warehouse.id,
              warehouseCode: warehouse.code,
              warehouseName: warehouse.name,
            })),
        ),
    });
  } catch (error) {
    return warehouseApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    // Autorización antes de leer el cuerpo; la clave de idempotencia evita entradas duplicadas por doble clic o reintento.
    const user = await requireWarehouseCapability("operate");
    const idempotencyKey = requireIdempotencyKey(request);
    if (!idempotencyKey) return missingIdempotencyKey();
    const body = await request.json();

    const itemId =
      typeof body.itemId === "string" ? body.itemId.trim() : "";
    const destinationLocationId =
      typeof body.destinationLocationId === "string"
        ? body.destinationLocationId.trim()
        : "";
    const quantity = parseWarehouseQuantity(body.quantity).toNumber();

    if (!itemId) {
      return NextResponse.json(
        { error: "Selecciona un artículo." },
        { status: 400 },
      );
    }

    if (!destinationLocationId) {
      return NextResponse.json(
        { error: "Selecciona una ubicación de destino." },
        { status: 400 },
      );
    }

    const validation = validateInventoryMovement({
      type: "EXTERNAL_RECEIPT",
      quantity,
      originLocationId: null,
      destinationLocationId,
    });

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const [item, destination] = await Promise.all([
      getInventoryItemById(itemId),
      getWarehouseLocationById(destinationLocationId),
    ]);

    if (!item || !item.active) {
      return NextResponse.json(
        { error: "El artículo seleccionado no existe o está inactivo." },
        { status: 400 },
      );
    }

    if (
      !destination ||
      !destination.active ||
      !destination.warehouse.active
    ) {
      return NextResponse.json(
        { error: "La ubicación seleccionada no está disponible." },
        { status: 400 },
      );
    }

    const data = {
      folio: createMovementFolio(),
      itemId: item.id,
      type: "EXTERNAL_RECEIPT" as const,
      quantity,
      unit: item.baseUnit,
      originLocationId: null,
      destinationLocationId: destination.id,
      referenceType: cleanOptional(body.referenceType),
      referenceNumber: cleanOptional(body.referenceNumber),
      notes: cleanOptional(body.notes),
      occurredAt: new Date(),
      actorId: user.id,
    };
    const { response, replayed } = await createExternalReceiptOnce(data, {
      idempotencyKey,
      payload: { itemId: data.itemId, destinationLocationId: data.destinationLocationId, quantity: parseWarehouseQuantity(body.quantity).toFixed(3),
        referenceType: data.referenceType, referenceNumber: data.referenceNumber, notes: data.notes },
    }, movement => ({
      movement: {
        id: movement.id,
        folio: movement.folio,
        itemId: movement.itemId,
        itemCode: movement.item.code,
        quantity: movement.quantity.toNumber(),
        unit: movement.unit,
        destinationLocation: movement.destinationLocation
          ? {
              id: movement.destinationLocation.id,
              code: movement.destinationLocation.code,
              warehouseName: movement.destinationLocation.warehouse.name,
            }
          : null,
        occurredAt: movement.occurredAt.toISOString(),
      },
    }));

    return NextResponse.json({ ...response, replayed }, { status: replayed ? 200 : 201 });
  } catch (error) {
    return warehouseApiError(error);
  }
}
