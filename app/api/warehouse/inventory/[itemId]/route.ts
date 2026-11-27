import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { warehouseApiError } from "@/lib/warehouse/api-error";
import { db } from "@/lib/db";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { listActiveCustodiesByItem } from "@/repositories/warehouse-custody.repository";
import {
  getInventoryBalancesByItem,
  getInventoryItemById,
  listInventoryMovements,
} from "@/repositories/warehouse.repository";


export async function GET(
  _request: Request,
  context: { params: Promise<{ itemId: string }> },
) {
  try {
    await requireWarehouseCapability("view");
    const { itemId } = await context.params;

    const item = await getInventoryItemById(itemId);

    if (!item) {
      return NextResponse.json(
        { error: "El artículo solicitado no existe." },
        { status: 404 },
      );
    }

    const [balances, movements, custodies, movementTotal] = await Promise.all([
      getInventoryBalancesByItem(itemId),
      listInventoryMovements({ itemId, limit: 200 }),
      listActiveCustodiesByItem(itemId),
      db.inventoryMovement.count({ where: { itemId } }),
    ]);

    // YF-003: aritmética decimal exacta. Existencia en Almacén y custodia de Producción se reportan por separado.
    const controlledExact = balances.reduce((total, balance) => total.plus(balance.quantity), new Prisma.Decimal(0));
    const custodyExact = custodies
      .filter((custody) => custody.locationId === null)
      .reduce((total, custody) => total.plus(custody.quantity), new Prisma.Decimal(0));
    const controlledQuantity = controlledExact.toNumber();
    const operationalCustodyQuantity = custodyExact.toNumber();

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
        yellowflexQuantity: controlledExact.plus(custodyExact).toNumber(),
        locationCount: balances.filter((balance) => balance.quantity !== 0).length,
        // YF-003: total real (antes era el tamaño de la lista mostrada, limitada a 200). El historial completo está en el Kardex.
        movementCount: movementTotal,
        movementsShown: movements.length,
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
    return warehouseApiError(error);
  }
}
