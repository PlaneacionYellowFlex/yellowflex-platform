import { NextRequest, NextResponse } from "next/server";

import { requireCorporateUser } from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";
import { HR_REQUEST_TYPES, isHrRequestType } from "@/lib/hr/request-config";

export const dynamic = "force-dynamic";

function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function toDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

async function nextFolio() {
  const year = new Date().getFullYear();
  const prefix = `RH-${year}-`;
  const latest = await db.hrRequest.findFirst({
    where: { folio: { startsWith: prefix } },
    orderBy: { folio: "desc" },
    select: { folio: true },
  });
  const current = latest ? Number(latest.folio.split("-").at(-1)) || 0 : 0;
  return `${prefix}${String(current + 1).padStart(5, "0")}`;
}

const includeRequest = {
  employee: {
    select: {
      id: true,
      employeeNumber: true,
      fullName: true,
      position: true,
      department: { select: { id: true, name: true, code: true } },
      profile: {
        select: {
          managerId: true,
          managerUserId: true,
          manager: { select: { id: true, fullName: true, employeeNumber: true } },
          managerUser: { select: { id: true, name: true, email: true } },
        },
      },
    },
  },
  decisions: {
    orderBy: { createdAt: "asc" as const },
    include: { actor: { select: { id: true, name: true, email: true } } },
  },
  events: {
    orderBy: { createdAt: "asc" as const },
    include: { actor: { select: { id: true, name: true } } },
  },
} as const;

export async function GET(request: NextRequest) {
  try {
    const user = await requireCorporateUser();
    const scope = request.nextUrl.searchParams.get("scope");
    const isHr = user.roles.includes("RH") || user.roles.includes("ADMIN");

    if (scope === "all") {
      if (!isHr) return apiError("Solo Recursos Humanos puede consultar todas las solicitudes.", 403);
      const requests = await db.hrRequest.findMany({
        include: includeRequest,
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({ requests });
    }

    if (scope === "team") {
      const reportsToCurrentUser = user.employee?.id
        ? { OR: [{ managerId: user.employee.id }, { managerUserId: user.id }] }
        : { managerUserId: user.id };

      const requests = await db.hrRequest.findMany({
        where: { employee: { profile: reportsToCurrentUser } },
        include: includeRequest,
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({ requests });
    }

    if (!user.employee?.id) {
      return NextResponse.json({
        requests: [],
        routing: { employeeName: user.name, managerName: null },
      });
    }

    const employee = await db.employee.findUnique({
      where: { id: user.employee.id },
      select: {
        fullName: true,
        profile: {
          select: {
            manager: { select: { fullName: true } },
            managerUser: { select: { name: true } },
          },
        },
      },
    });

    const requests = await db.hrRequest.findMany({
      where: { employeeId: user.employee.id },
      include: includeRequest,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      requests,
      routing: {
        employeeName: employee?.fullName ?? user.name,
        managerName:
          employee?.profile?.manager?.fullName ??
          employee?.profile?.managerUser?.name ??
          null,
      },
    });
  } catch (error) {
    console.error("GET /api/hr/requests", error);
    return apiError("No fue posible consultar las solicitudes.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireCorporateUser();
    if (!user.employee?.id) {
      return apiError("Tu cuenta corporativa no está vinculada a un colaborador de RH.", 409);
    }

    const body = await request.json();
    const type = String(body.type ?? "");
    const startDate = String(body.startDate ?? "");
    const endDate = body.endDate ? String(body.endDate) : null;
    const startTime = body.startTime ? String(body.startTime) : null;
    const endTime = body.endTime ? String(body.endTime) : null;
    const reason = String(body.reason ?? "").trim();
    const requestedDays =
      body.requestedDays === "" || body.requestedDays == null
        ? null
        : Number(body.requestedDays);
    const requestedMinutes =
      body.requestedMinutes === "" || body.requestedMinutes == null
        ? null
        : Number(body.requestedMinutes);

    if (!isHrRequestType(type)) return apiError("Tipo de solicitud no válido.", 422);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return apiError("La fecha inicial es obligatoria.", 422);
    if (!reason) return apiError("Explica el motivo de la solicitud.", 422);
    if (endDate && toDate(endDate) < toDate(startDate)) return apiError("La fecha final no puede ser anterior a la inicial.", 422);
    if (type === "VACATION" && (!requestedDays || requestedDays <= 0)) return apiError("Indica los días de vacaciones solicitados.", 422);
    if (["EARLY_DEPARTURE", "LATE_ARRIVAL", "HOURLY_PERMISSION"].includes(type) && !startTime) return apiError("Indica la hora correspondiente.", 422);
    if (type === "HOURLY_PERMISSION" && !endTime) return apiError("Indica la hora de regreso.", 422);

    const employee = await db.employee.findUnique({
      where: { id: user.employee.id },
      select: {
        id: true,
        status: true,
        profile: { select: { managerId: true, managerUserId: true } },
      },
    });

    if (!employee || employee.status !== "ACTIVE") {
      return apiError("El colaborador no se encuentra activo.", 409);
    }

    const config = HR_REQUEST_TYPES[type];

    if (
      config.route === "MANAGER_THEN_HR" &&
      !employee.profile?.managerId &&
      !employee.profile?.managerUserId
    ) {
      return apiError(
        "RH debe asignar primero un jefe inmediato a tu expediente antes de enviar esta solicitud.",
        409,
      );
    }

    const folio = await nextFolio();
    const initialStatus =
      config.route === "MANAGER_THEN_HR" ? "PENDING_MANAGER" : "PENDING_HR";

    const created = await db.$transaction(async (tx) => {
      const hrRequest = await tx.hrRequest.create({
        data: {
          folio,
          employeeId: employee.id,
          type,
          status: initialStatus,
          approvalRoute: config.route,
          startDate: toDate(startDate),
          endDate: endDate ? toDate(endDate) : null,
          startTime,
          endTime,
          requestedDays,
          requestedMinutes,
          reason,
          employeeComment: body.employeeComment
            ? String(body.employeeComment).trim()
            : null,
          submittedAt: new Date(),
        },
      });

      await tx.hrRequestEvent.createMany({
        data: [
          { requestId: hrRequest.id, actorId: user.id, eventType: "CREATED" },
          { requestId: hrRequest.id, actorId: user.id, eventType: "SUBMITTED" },
        ],
      });

      return hrRequest;
    });

    return NextResponse.json({ request: created }, { status: 201 });
  } catch (error) {
    console.error("POST /api/hr/requests", error);
    return apiError("No fue posible crear la solicitud.", 500);
  }
}
