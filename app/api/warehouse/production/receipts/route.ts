import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import {
  CorporateAuthorizationRequired,
  requireCorporateUser,
} from "@/lib/auth/corporate-auth";
import { listProductionCustodiesInTransit } from "@/repositories/warehouse-custody.repository";

async function requireProductionReceptionAccess() {
  const user = await requireCorporateUser();

  if (
    user.roles.some(
      (role) =>
        role === "ADMIN" || role === "DIRECCION" || role === "PRODUCCION",
    )
  ) {
    return user;
  }

  throw new CorporateAuthorizationRequired(
    "No tienes permiso para recibir material de Producción.",
  );
}

export async function GET() {
  try {
    await requireProductionReceptionAccess();

    const custodies = await listProductionCustodiesInTransit();

    return NextResponse.json({
      custodies: custodies.map((custody) => ({
        id: custody.id,
        folio: custody.folio,
        quantity: custody.quantity.toNumber(),
        unit: custody.unit,
        status: custody.status,
        enteredAt: custody.enteredAt,
        referenceType: custody.referenceType,
        referenceNumber: custody.referenceNumber,
        notes: custody.notes,
        item: {
          id: custody.item.id,
          code: custody.item.code,
          description: custody.item.description,
          baseUnit: custody.item.baseUnit,
        },
        custodianArea: {
          id: custody.custodianArea.id,
          code: custody.custodianArea.code,
          name: custody.custodianArea.name,
        },
        createdBy: custody.createdBy,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
