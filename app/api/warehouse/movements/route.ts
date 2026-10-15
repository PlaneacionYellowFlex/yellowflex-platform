import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { validateInventoryMovement } from "@/engines/warehouse";
import { apiError } from "@/lib/api-response";
import {
  CorporateAuthorizationRequired,
  requireCorporateUser,
} from "@/lib/auth/corporate-auth";
import {
  getInventoryItemById,
  getWarehouseLocationById,
  getWarehousePermission,
  listInventoryItems,
  listWarehouses,
} from "@/repositories/warehouse.repository";
import { createWarehouseMovement } from "@/repositories/warehouse-movements.repository";

async function requireWarehouseMovementAccess() {
  const user = await requireCorporateUser();

  if (user.roles.some((role) => role === "ADMIN" || role === "DIRECCION")) {
    return user;
  }

  const permission = await getWarehousePermission(user.id);

  if (!permission?.canRegisterMovement) {
    throw new CorporateAuthorizationRequired(
      "No tienes permiso para registrar movimientos de Almacén.",
    );
  }

  return user;
}

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
    await requireWarehouseMovementAccess();

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
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireWarehouseMovementAccess();
    const body = await request.json();

    const itemId =
      typeof body.itemId === "string" ? body.itemId.trim() : "";
    const destinationLocationId =
      typeof body.destinationLocationId === "string"
        ? body.destinationLocationId.trim()
        : "";
    const quantity = Number(body.quantity);

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

    const movement = await createWarehouseMovement({
      folio: createMovementFolio(),
      itemId: item.id,
      type: "EXTERNAL_RECEIPT",
      quantity,
      unit: item.baseUnit,
      originLocationId: null,
      destinationLocationId: destination.id,
      referenceType: cleanOptional(body.referenceType),
      referenceNumber: cleanOptional(body.referenceNumber),
      notes: cleanOptional(body.notes),
      occurredAt: new Date(),
      actorId: user.id,
    });

    return NextResponse.json(
      {
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
          occurredAt: movement.occurredAt,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
