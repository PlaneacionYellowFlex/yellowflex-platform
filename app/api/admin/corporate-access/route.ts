import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

import { apiError } from "@/lib/api-response";
import {
  CorporateAuthorizationRequired,
  requireCorporateUser,
} from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const roles = [
  "ADMIN",
  "DIRECCION",
  "RH",
  "CHEF",
  "PLANEACION",
  "PRODUCCION",
  "MANTENIMIENTO",
  "EMPLEADO",
] as const;

const purchaseSchema = z.object({
  canRequest: z.boolean(),
  canRequestUrgent: z.boolean(),
  canAuthorize: z.boolean(),
  canViewAll: z.boolean(),
  canManagePurchases: z.boolean(),
});

const createSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(3).max(160),
  employeeId: z.string().min(1).nullable(),
  role: z.enum(roles),
  purchasePermissions: purchaseSchema,
}).strict();

const updateSchema = z.object({
  userId: z.string().min(1),
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(3).max(160),
  role: z.enum(roles),
  active: z.boolean(),
  purchasePermissions: purchaseSchema,
}).strict();

const noPermissions = {
  canRequest: false,
  canRequestUrgent: false,
  canAuthorize: false,
  canViewAll: false,
  canManagePurchases: false,
};

async function administrator() {
  const user = await requireCorporateUser();
  if (!user.roles.includes("ADMIN")) {
    throw new CorporateAuthorizationRequired(
      "Solo Administrador puede gestionar usuarios y accesos corporativos.",
    );
  }
  return user;
}

function permissionError(p: typeof noPermissions) {
  return p.canRequestUrgent && !p.canRequest
    ? "Compras urgentes requiere permiso para solicitar compras."
    : null;
}

export async function GET() {
  try {
    await administrator();

    const [users, employees] = await Promise.all([
      db.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          active: true,
          passwordMustChange: true,
          roles: { select: { role: true } },
          employee: {
            select: {
              id: true,
              employeeNumber: true,
              fullName: true,
              position: true,
              status: true,
              department: { select: { code: true, name: true } },
            },
          },
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
      }),
      db.employee.findMany({
        where: { status: "ACTIVE" },
        select: {
          id: true,
          employeeNumber: true,
          fullName: true,
          position: true,
          status: true,
          corporateUserId: true,
          department: { select: { code: true, name: true } },
        },
        orderBy: { fullName: "asc" },
      }),
    ]);

    return NextResponse.json({
      users: users.map((u) => ({
        ...u,
        roles: u.roles.map((r) => r.role),
        purchasePermissions: u.purchasePermission ?? noPermissions,
      })),
      employees,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await administrator();
    const input = createSchema.parse(await request.json());
    const email = input.email.toLowerCase();
    const pError = permissionError(input.purchasePermissions);
    if (pError) return NextResponse.json({ error: pError }, { status: 422 });

    if (input.role !== "DIRECCION" && !input.employeeId) {
      return NextResponse.json(
        { error: "Selecciona un colaborador existente." },
        { status: 422 },
      );
    }

    const password = randomBytes(24).toString("base64url");
    const passwordHash = await bcrypt.hash(password, 12);

    const created = await db.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
        throw new Error("ACCOUNT_EXISTS");
      }

      if (input.employeeId) {
        const employee = await tx.employee.findUnique({
          where: { id: input.employeeId },
          select: { status: true, corporateUserId: true },
        });
        if (!employee || employee.status !== "ACTIVE" || employee.corporateUserId) {
          throw new Error("EMPLOYEE_UNAVAILABLE");
        }
      }

      const user = await tx.user.create({
        data: {
          email,
          name: input.name,
          passwordHash,
          passwordMustChange: true,
          roles: { create: [{ role: input.role }] },
          purchasePermission: { create: input.purchasePermissions },
        },
        select: { id: true, name: true, email: true },
      });

      if (input.employeeId) {
        await tx.employee.update({
          where: { id: input.employeeId },
          data: { corporateUserId: user.id },
        });
      }
      return user;
    });

    return NextResponse.json(
      { user: created, initialPassword: password },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_EXISTS") {
      return NextResponse.json({ error: "Ya existe una cuenta con ese correo." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "EMPLOYEE_UNAVAILABLE") {
      return NextResponse.json({ error: "El colaborador no está disponible o ya tiene cuenta." }, { status: 409 });
    }
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await administrator();
    const input = updateSchema.parse(await request.json());
    const email = input.email.toLowerCase();
    const pError = permissionError(input.purchasePermissions);
    if (pError) return NextResponse.json({ error: pError }, { status: 422 });

    const target = await db.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json({ error: "La cuenta ya no existe." }, { status: 404 });
    }

    if (actor.id === input.userId && !input.active) {
      return NextResponse.json(
        { error: "No puedes desactivar tu propia cuenta." },
        { status: 422 },
      );
    }
    if (actor.id === input.userId && input.role !== "ADMIN") {
      return NextResponse.json(
        { error: "No puedes retirar tu propio rol ADMIN desde esta pantalla." },
        { status: 422 },
      );
    }

    const emailOwner = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (emailOwner && emailOwner.id !== input.userId) {
      return NextResponse.json(
        { error: "Ese correo ya pertenece a otra cuenta." },
        { status: 409 },
      );
    }

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: input.userId },
        data: { name: input.name, email, active: input.active },
      });
      await tx.userRole.deleteMany({ where: { userId: input.userId } });
      await tx.userRole.create({
        data: { userId: input.userId, role: input.role },
      });
      await tx.purchasePermission.upsert({
        where: { userId: input.userId },
        create: { userId: input.userId, ...input.purchasePermissions },
        update: input.purchasePermissions,
      });
      if (!input.active) {
        await tx.corporateSession.deleteMany({ where: { userId: input.userId } });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
