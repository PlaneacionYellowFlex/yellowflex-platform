import { NextRequest, NextResponse } from "next/server";

import { requireCorporateUser } from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

type Decision = "APPROVE" | "REJECT" | "REQUEST_INFORMATION";

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireCorporateUser();
    const { id } = await context.params;
    const body = await request.json();
    const decision = String(body.decision ?? "") as Decision;
    const comment = body.comment ? String(body.comment).trim() : null;

    if (!["APPROVE", "REJECT", "REQUEST_INFORMATION"].includes(decision)) {
      return apiError("Decisión no válida.", 422);
    }

    if ((decision === "REJECT" || decision === "REQUEST_INFORMATION") && !comment) {
      return apiError("Indica el motivo de la decisión.", 422);
    }

    const hrRequest = await db.hrRequest.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            profile: {
              select: {
                managerId: true,
                managerUserId: true,
              },
            },
          },
        },
      },
    });

    if (!hrRequest) return apiError("La solicitud no fue encontrada.", 404);

    const isHr = user.roles.includes("RH") || user.roles.includes("ADMIN");
    const isManager =
      (Boolean(user.employee?.id) &&
        hrRequest.employee.profile?.managerId === user.employee?.id) ||
      hrRequest.employee.profile?.managerUserId === user.id;

    let stage: "MANAGER" | "HR";
    let nextStatus: "PENDING_HR" | "AUTHORIZED" | "REJECTED" | "INFORMATION_REQUIRED";

    if (hrRequest.status === "PENDING_MANAGER") {
      if (!isManager) {
        return apiError("Solo el jefe inmediato asignado puede resolver esta etapa.", 403);
      }
      stage = "MANAGER";
      if (decision === "APPROVE") nextStatus = "PENDING_HR";
      else if (decision === "REJECT") nextStatus = "REJECTED";
      else nextStatus = "INFORMATION_REQUIRED";
    } else if (hrRequest.status === "PENDING_HR") {
      if (!isHr) {
        return apiError("Solo Recursos Humanos puede resolver esta etapa.", 403);
      }
      stage = "HR";
      if (decision === "APPROVE") nextStatus = "AUTHORIZED";
      else if (decision === "REJECT") nextStatus = "REJECTED";
      else nextStatus = "INFORMATION_REQUIRED";
    } else {
      return apiError("La solicitud ya no se encuentra pendiente de decisión.", 409);
    }

    const result = await db.$transaction(async (tx) => {
      await tx.hrRequestDecision.create({
        data: {
          requestId: hrRequest.id,
          actorId: user.id,
          stage,
          decision,
          comment,
        },
      });

      const updated = await tx.hrRequest.update({
        where: { id: hrRequest.id },
        data: {
          status: nextStatus,
          resolvedAt:
            nextStatus === "AUTHORIZED" || nextStatus === "REJECTED"
              ? new Date()
              : null,
        },
      });

      await tx.hrRequestEvent.create({
        data: {
          requestId: hrRequest.id,
          actorId: user.id,
          eventType: "DECISION_RECORDED",
          details: { stage, decision, comment, nextStatus },
        },
      });

      if (nextStatus === "AUTHORIZED" || nextStatus === "REJECTED") {
        await tx.hrRequestEvent.create({
          data: {
            requestId: hrRequest.id,
            actorId: user.id,
            eventType: nextStatus === "AUTHORIZED" ? "AUTHORIZED" : "REJECTED",
          },
        });
      }

      return updated;
    });

    return NextResponse.json({ request: result });
  } catch (error) {
    console.error("POST /api/hr/requests/[id]/decision", error);
    return apiError("No fue posible registrar la decisión.", 500);
  }
}
