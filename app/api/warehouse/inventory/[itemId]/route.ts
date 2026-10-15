import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import {
  CorporateAuthorizationRequired,
  requireCorporateUser,
} from "@/lib/auth/corporate-auth";
import { listActiveCustodiesByItem } from "@/repositories/warehouse-custody.repository";
import {
  getInventoryBalancesByItem,
  getInventoryItemById,
  getWarehousePermission,
  listInventoryMovements,
} from "@/repositories/warehouse.repository";

async function requireWarehouseInventoryAccess() {
  const user = await requireCorporateUser();

  if (user.roles.some((role) => role === "ADMIN" || role === "DIRECCION")) {
    return user;
  }

  const permission = await getWarehousePermission(user.id);

  if (!permission?.canViewInventory) {
    throw new CorporateAuthorizationRequired(
      "No tienes permiso para consultar el inventario de Almacén.",
    );
  }

  return user;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ itemId: string }> },
) {
  try {
    await requireWarehouseInventoryAccess();
    const { itemId } = await context.params;

    const item = await getInventoryItemById(itemId);

    if (!item) {
      return NextResponse.json(
        { error: "El artículo solicitado no existe." },
        { status: 404 },
      );
    }

    const [balances, movements, custodies] = await Promise.all([
      getInventoryBalancesByItem(itemId),
      listInventoryMovements({ itemId, limit: 200 }),
      listActiveCustodiesByItem(itemId),
    ]);

    const controlledQuantity = balances.reduce(
      (total, balance) => total + balance.quantity,
      0,
    );

    const operationalCustodyQuantity = custodies
      .filter((custody) => custody.locationId === null)
      .reduce((total, custody) => total + custody.quantity.toNumber(), 0);

    return NextResponse.json({
      item: {
        id: item.id,
        code: item.code,
        description: item.description,
        baseUnit: item.baseUnit,
        active: item.active,
      },
      summary: {
        controlledQuantity,
        operationalCustodyQuantity,
        yellowflexQuantity: controlledQuantity + operationalCustodyQuantity,
        locationCount: balances.filter((balance) => balance.quantity !== 0).length,
        movementCount: movements.length,
        custodyCount: custodies.filter((custody) => custody.locationId === null)
          .length,
      },
      balances,
      movements: movements.map((movement) => ({
        id: movement.id,
        folio: movement.folio,
        type: movement.type,
        quantity: movement.quantity.toNumber(),
        unit: movement.unit,
        originLocation: movement.originLocation
          ? {
              id: movement.originLocation.id,
              code: movement.originLocation.code,
              name: movement.originLocation.name,
              warehouseName: movement.originLocation.warehouse.name,
            }
          : null,
        destinationLocation: movement.destinationLocation
          ? {
              id: movement.destinationLocation.id,
              code: movement.destinationLocation.code,
              name: movement.destinationLocation.name,
              warehouseName: movement.destinationLocation.warehouse.name,
            }
          : null,
        referenceType: movement.referenceType,
        referenceNumber: movement.referenceNumber,
        notes: movement.notes,
        occurredAt: movement.occurredAt,
        actor: movement.actor,
      })),
      custodies: custodies
        .filter((custody) => custody.locationId === null)
        .map((custody) => ({
          id: custody.id,
          folio: custody.folio,
          quantity: custody.quantity.toNumber(),
          unit: custody.unit,
          status: custody.status,
          custodianArea: {
            id: custody.custodianArea.id,
            code: custody.custodianArea.code,
            name: custody.custodianArea.name,
          },
          nextActionArea: custody.nextActionArea
            ? {
                id: custody.nextActionArea.id,
                code: custody.nextActionArea.code,
                name: custody.nextActionArea.name,
              }
            : null,
          reason: custody.reason,
          referenceType: custody.referenceType,
          referenceNumber: custody.referenceNumber,
          notes: custody.notes,
          enteredAt: custody.enteredAt,
          createdBy: custody.createdBy,
        })),
    });
  } catch (error) {
    return apiError(error);
  }
}
