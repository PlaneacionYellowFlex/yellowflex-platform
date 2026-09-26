import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireCorporateUser } from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";
import { getMyPurchasePermissions } from "@/lib/purchases/purchase-permissions";

const schema = z.object({ purchasedAt: z.string().datetime().optional() }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireCorporateUser();
    const permissions = await getMyPurchasePermissions();
    const { id } = await context.params;
    const input = schema.parse(await request.json().catch(() => ({})));
    const existing = await db.purchaseRequest.findUnique({
      where: { id },
      select: { id: true, requesterId: true, isUrgent: true, authorizationStatus: true, purchasedAt: true },
    });
    if (!existing) return NextResponse.json({ error: "La solicitud no existe." }, { status: 404 });

    const canRecord = permissions.canManagePurchases ||
      (permissions.canRequest && existing.requesterId === actor.id);
    if (!canRecord) return NextResponse.json({ error: "No tienes permiso para registrar esta compra." }, { status: 403 });
    if (existing.purchasedAt) return NextResponse.json({ error: "La compra ya fue registrada." }, { status: 409 });

    const allowed = existing.isUrgent
      ? ["REGULARIZATION_PENDING", "REGULARIZED"].includes(existing.authorizationStatus)
      : existing.authorizationStatus === "AUTHORIZED";
    if (!allowed) return NextResponse.json({ error: "La compra no puede registrarse en el estado de autorización actual." }, { status: 422 });

    const purchasedAt = input.purchasedAt ? new Date(input.purchasedAt) : new Date();
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.purchaseRequest.update({
        where: { id },
        data: { purchasedAt, purchaseRecordedAt: new Date(), documentStatus: "INVOICE_PENDING", completedAt: null },
      });
      await tx.purchaseEvent.create({
        data: { requestId: id, actorId: actor.id, eventType: "PURCHASE_RECORDED", details: { purchasedAt: purchasedAt.toISOString() } },
      });
      return row;
    });
    return NextResponse.json({ request: updated });
  } catch (error) { return apiError(error); }
}
