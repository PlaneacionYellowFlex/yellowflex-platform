import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import {
  CorporateAuthorizationRequired,
  requireCorporateUser,
} from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";

const updatePermissionsSchema = z
  .object({
    userId: z.string().min(1),
    canRequest: z.boolean(),
    canRequestUrgent: z.boolean(),
    canAuthorize: z.boolean(),
    canViewAll: z.boolean(),
    canManagePurchases: z.boolean(),
  })
  .strict();

async function requirePurchasePermissionsAdministrator() {
  const user = await requireCorporateUser();
  const permission = await db.purchasePermission.findUnique({
    where: { userId: user.id },
    select: { canManagePurchases: true },
  });

  if (
    !user.roles.some((role) => role === "ADMIN" || role === "DIRECCION") &&
    !permission?.canManagePurchases
  ) {
    throw new CorporateAuthorizationRequired(
      "No tienes permiso para administrar Compras.",
    );
  }

  return user;
}

export async function GET() {
  try {
    await requirePurchasePermissionsAdministrator();

    const users = await db.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        roles: { select: { role: true } },
        purchasePermission: {
          select: {
            canRequest: true,
            canRequestUrgent: true,
            canAuthorize: true,
            canViewAll: true,
            canManagePurchases: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        active: user.active,
        roles: user.roles.map(({ role }) => role),
        permissions: user.purchasePermission ?? {
          canRequest: false,
          canRequestUrgent: false,
          canAuthorize: false,
          canViewAll: false,
          canManagePurchases: false,
        },
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requirePurchasePermissionsAdministrator();
    const input = updatePermissionsSchema.parse(await request.json());

    const target = await db.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        active: true,
        roles: { select: { role: true } },
      },
    });

    if (!target || !target.active) {
      return NextResponse.json(
        { error: "El usuario no existe o está inactivo." },
        { status: 404 },
      );
    }

    if (input.canRequestUrgent && !input.canRequest) {
      return NextResponse.json(
        { error: "El permiso de urgencia requiere permiso para solicitar." },
        { status: 422 },
      );
    }

    const actorIsCorporateAdministrator = actor.roles.some(
      (role) => role === "ADMIN" || role === "DIRECCION",
    );

    if (!actorIsCorporateAdministrator) {
      const own = await db.purchasePermission.findUnique({
        where: { userId: actor.id },
        select: { canManagePurchases: true },
      });

      if (!own?.canManagePurchases) {
        return NextResponse.json(
          { error: "No tienes permiso para administrar Compras." },
          { status: 403 },
        );
      }

      if (
        target.roles.some(
          ({ role }) => role === "ADMIN" || role === "DIRECCION",
        )
      ) {
        return NextResponse.json(
          {
            error:
              "No puedes modificar permisos de Dirección o Administrador.",
          },
          { status: 403 },
        );
      }

      const existing = await db.purchasePermission.findUnique({
        where: { userId: input.userId },
        select: {
          canAuthorize: true,
          canManagePurchases: true,
        },
      });

      const currentCanAuthorize = existing?.canAuthorize ?? false;
      const currentCanManagePurchases =
        existing?.canManagePurchases ?? false;

      if (input.canAuthorize !== currentCanAuthorize) {
        return NextResponse.json(
          {
            error:
              "Solo Dirección o Administrador pueden conceder o retirar autorización de compras.",
          },
          { status: 403 },
        );
      }

      if (input.canManagePurchases !== currentCanManagePurchases) {
        return NextResponse.json(
          {
            error:
              "Solo Dirección o Administrador pueden conceder o retirar administración de Compras.",
          },
          { status: 403 },
        );
      }
    }

    const { userId, ...permissions } = input;

    const saved = await db.purchasePermission.upsert({
      where: { userId },
      create: { userId, ...permissions },
      update: permissions,
      select: {
        canRequest: true,
        canRequestUrgent: true,
        canAuthorize: true,
        canViewAll: true,
        canManagePurchases: true,
      },
    });

    return NextResponse.json({ userId, permissions: saved });
  } catch (error) {
    return apiError(error);
  }
}
