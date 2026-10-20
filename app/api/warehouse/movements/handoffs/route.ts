import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { validateInventoryMovement } from "@/engines/warehouse";
import { apiError } from "@/lib/api-response";
import {
  CorporateAuthorizationRequired,
  requireCorporateUser,
} from "@/lib/auth/corporate-auth";
import { InvalidWarehouseQuantityError, parseWarehouseQuantity } from "@/lib/warehouse-quantity";
import {
  createOperationalHandoff,
  InsufficientWarehouseStockError,
} from "@/repositories/warehouse-custody.repository";
import {
  getInventoryBalances,
  getInventoryItemById,
  getWarehouseLocationById,
  getWarehousePermission,
  listInventoryItems,
} from "@/repositories/warehouse.repository";
import { db } from "@/lib/db";

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

export async function GET() {
  try {
    await requireWarehouseMovementAccess();

    const [items, balances] = await Promise.all([
      listInventoryItems(),
      getInventoryBalances(),
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
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireWarehouseMovementAccess();
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

    const result = await createOperationalHandoff({
      movementFolio: movementFolio(occurredAt),
      custodyFolio: custodyFolio(occurredAt),
      itemId: item.id,
      quantity,
      unit: item.baseUnit,
      originLocationId: originLocation.id,
      warehouseAreaId: warehouseArea.id,
      productionAreaId: productionArea.id,
      referenceType:
        typeof body.referenceType === "string" ? body.referenceType : null,
      referenceNumber:
        typeof body.referenceNumber === "string" ? body.referenceNumber : null,
      reason: "Entrega operativa de Almacén a Producción",
      notes: typeof body.notes === "string" ? body.notes : null,
      occurredAt,
      actorId: user.id,
    });

    return NextResponse.json(
      {
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
      },
      { status: 201 },
    );
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

    return apiError(error);
  }
}
