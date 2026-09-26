import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireCorporateUser } from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";
import { generatePurchaseFolio } from "@/lib/purchases/purchase-folio";
import { getMyPurchasePermissions } from "@/lib/purchases/purchase-permissions";

const itemSchema = z.object({
  description: z.string().trim().min(2).max(500),
  quantity: z.coerce.number().positive().max(999999999),
  unit: z.string().trim().min(1).max(50),
});

const createSchema = z.object({
  justification: z.string().trim().min(5).max(3000),
  requiredDate: z.string().trim().nullable().optional(),
  isUrgent: z.boolean().default(false),
  urgencyReason: z.string().trim().max(2000).nullable().optional(),
  items: z.array(itemSchema).min(1).max(100),
}).strict();

function requestSelect() {
  return {
    id: true,
    folio: true,
    requesterId: true,
    requesterDepartment: true,
    description: true,
    quantity: true,
    unit: true,
    justification: true,
    requiredDate: true,
    isUrgent: true,
    urgencyReason: true,
    authorizationStatus: true,
    documentStatus: true,
    purchasedAt: true,
    purchaseRecordedAt: true,
    completedAt: true,
    createdAt: true,
    updatedAt: true,
    requester: { select: { id: true, name: true, email: true } },
    items: {
      select: {
        id: true,
        description: true,
        quantity: true,
        unit: true,
        position: true,
      },
      orderBy: { position: "asc" as const },
    },
  };
}

export async function GET() {
  try {
    const user = await requireCorporateUser();
    const permissions = await getMyPurchasePermissions();

    if (!permissions.canRequest && !permissions.canViewAll) {
      return NextResponse.json(
        { error: "No tienes permiso para consultar solicitudes de Compras." },
        { status: 403 },
      );
    }

    const requests = await db.purchaseRequest.findMany({
      where: permissions.canViewAll ? undefined : { requesterId: user.id },
      select: requestSelect(),
      orderBy: { createdAt: "desc" },
      take: 250,
    });

    return NextResponse.json({ requests });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCorporateUser();
    const permissions = await getMyPurchasePermissions();
    const input = createSchema.parse(await request.json());

    if (!permissions.canRequest) {
      return NextResponse.json(
        { error: "No tienes permiso para solicitar compras." },
        { status: 403 },
      );
    }

    if (input.isUrgent && !permissions.canRequestUrgent) {
      return NextResponse.json(
        { error: "No tienes permiso para registrar compras urgentes." },
        { status: 403 },
      );
    }

    if (input.isUrgent && !input.urgencyReason?.trim()) {
      return NextResponse.json(
        { error: "Una compra urgente requiere indicar el motivo de urgencia." },
        { status: 422 },
      );
    }

    let requiredDate: Date | null = null;
    if (input.requiredDate) {
      requiredDate = new Date(`${input.requiredDate}T12:00:00.000Z`);
      if (Number.isNaN(requiredDate.getTime())) {
        return NextResponse.json(
          { error: "La fecha requerida no es válida." },
          { status: 422 },
        );
      }
    }

    const employee = await db.employee.findUnique({
      where: { corporateUserId: user.id },
      select: { department: { select: { name: true } } },
    });

    const firstItem = input.items[0];
    let created = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const folio = await generatePurchaseFolio();

      try {
        created = await db.$transaction(async (tx) => {
          const purchaseRequest = await tx.purchaseRequest.create({
            data: {
              folio,
              requesterId: user.id,
              requesterDepartment: employee?.department.name ?? null,
              description:
                input.items.length === 1
                  ? firstItem.description
                  : `Solicitud con ${input.items.length} partidas`,
              quantity: new Prisma.Decimal(firstItem.quantity),
              unit: firstItem.unit,
              justification: input.justification,
              requiredDate,
              isUrgent: input.isUrgent,
              urgencyReason: input.isUrgent
                ? input.urgencyReason?.trim() || null
                : null,
              authorizationStatus: input.isUrgent
                ? "REGULARIZATION_PENDING"
                : "PENDING",
              documentStatus: "PENDING",
              items: {
                create: input.items.map((item, index) => ({
                  description: item.description,
                  quantity: new Prisma.Decimal(item.quantity),
                  unit: item.unit,
                  position: index + 1,
                })),
              },
            },
            select: requestSelect(),
          });

          await tx.purchaseEvent.create({
            data: {
              requestId: purchaseRequest.id,
              actorId: user.id,
              eventType: "REQUEST_CREATED",
              details: {
                folio: purchaseRequest.folio,
                isUrgent: purchaseRequest.isUrgent,
                itemCount: input.items.length,
              },
            },
          });

          return purchaseRequest;
        });

        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      return NextResponse.json(
        { error: "No fue posible generar un folio único. Intenta nuevamente." },
        { status: 409 },
      );
    }

    return NextResponse.json({ request: created }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
