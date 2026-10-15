import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import {
  CorporateAuthorizationRequired,
  requireCorporateUser,
} from "@/lib/auth/corporate-auth";
import {
  InvalidCustodyReceptionError,
  receiveProductionCustody,
} from "@/repositories/warehouse-custody.repository";

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

export async function POST(
  request: Request,
  context: { params: Promise<{ custodyId: string }> },
) {
  try {
    const user = await requireProductionReceptionAccess();
    const { custodyId } = await context.params;
    const body = await request.json();

    const receivedQuantity = Number(body.receivedQuantity);
    const notes = typeof body.notes === "string" ? body.notes : null;

    const custody = await receiveProductionCustody({
      custodyId,
      receivedQuantity,
      notes,
      actorId: user.id,
      occurredAt: new Date(),
    });

    return NextResponse.json({
      custody: {
        id: custody.id,
        folio: custody.folio,
        status: custody.status,
        quantity: custody.quantity.toNumber(),
        unit: custody.unit,
        enteredAt: custody.enteredAt,
        item: {
          id: custody.item.id,
          code: custody.item.code,
          description: custody.item.description,
        },
        custodianArea: {
          id: custody.custodianArea.id,
          code: custody.custodianArea.code,
          name: custody.custodianArea.name,
        },
      },
    });
  } catch (error) {
    if (error instanceof InvalidCustodyReceptionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return apiError(error);
  }
}
