import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { db } from "@/lib/db";
import { requirePurchaseDecisionAccess } from "@/lib/purchases/purchase-permissions";

const decisionSchema = z.object({
  decision: z.enum([
    "AUTHORIZE",
    "REJECT",
    "REQUEST_INFORMATION",
    "REGULARIZE",
    "REJECT_REGULARIZATION",
  ]),
  reason: z.string().trim().max(2000).nullable().optional(),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const input = decisionSchema.parse(await request.json());

    const existing = await db.purchaseRequest.findUnique({
      where: { id },
      select: {
        id: true,
        requesterId: true,
        isUrgent: true,
        authorizationStatus: true,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "La solicitud no existe." },
        { status: 404 },
      );
    }

    const actor = await requirePurchaseDecisionAccess(existing.requesterId);

    const normalAllowed =
      !existing.isUrgent &&
      ["PENDING", "INFORMATION_REQUIRED"].includes(
        existing.authorizationStatus,
      ) &&
      ["AUTHORIZE", "REJECT", "REQUEST_INFORMATION"].includes(input.decision);

    const urgentAllowed =
      existing.isUrgent &&
      existing.authorizationStatus === "REGULARIZATION_PENDING" &&
      ["REGULARIZE", "REJECT_REGULARIZATION"].includes(input.decision);

    if (!normalAllowed && !urgentAllowed) {
      return NextResponse.json(
        { error: "La decisión no corresponde al estado actual de la solicitud." },
        { status: 422 },
      );
    }

    if (
      ["REJECT", "REQUEST_INFORMATION", "REJECT_REGULARIZATION"].includes(
        input.decision,
      ) &&
      !input.reason?.trim()
    ) {
      return NextResponse.json(
        { error: "Esta decisión requiere indicar un motivo." },
        { status: 422 },
      );
    }

    const statusByDecision = {
      AUTHORIZE: "AUTHORIZED",
      REJECT: "REJECTED",
      REQUEST_INFORMATION: "INFORMATION_REQUIRED",
      REGULARIZE: "REGULARIZED",
      REJECT_REGULARIZATION: "REGULARIZATION_REJECTED",
    } as const;

    const result = await db.$transaction(async (tx) => {
      const decision = await tx.purchaseDecision.create({
        data: {
          requestId: existing.id,
          decidedById: actor.id,
          decision: input.decision,
          reason: input.reason?.trim() || null,
        },
      });

      const updated = await tx.purchaseRequest.update({
        where: { id: existing.id },
        data: {
          authorizationStatus: statusByDecision[input.decision],
        },
      });

      await tx.purchaseEvent.create({
        data: {
          requestId: existing.id,
          actorId: actor.id,
          eventType: "DECISION_RECORDED",
          details: {
            decision: input.decision,
            reason: input.reason?.trim() || null,
            authorizationStatus: updated.authorizationStatus,
          },
        },
      });

      return { decision, request: updated };
    });

    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
