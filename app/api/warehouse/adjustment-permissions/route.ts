import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCorporateUser, CorporateAuthenticationRequired } from "@/lib/auth/corporate-auth";

const changeSchema = z.object({
  userId: z.string().min(1),
  canApproveWarehouseAdjustments: z.boolean(),
  reason: z.string().trim().min(10).max(500),
});

export async function GET() {
  try {
    const actor = await requireCorporateUser();
    const access = await db.warehousePermission.findUnique({
      where: { userId: actor.id },
      select: { canManageAdjustmentPermissions: true },
    });
    if (access?.canManageAdjustmentPermissions !== true) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const [users, audit] = await Promise.all([db.user.findMany({
      where: { active: true },
      select: {
        id: true, name: true, email: true,
        warehousePermission: { select: { canApproveWarehouseAdjustments: true } },
      },
      orderBy: { name: "asc" },
    }), db.warehousePermissionAudit.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { actor: { select: { name: true } }, targetUser: { select: { name: true } } },
    })]);
    return NextResponse.json({
      audit: audit.map(entry => ({ id: entry.id, actor: entry.actor.name, target: entry.targetUser.name, action: entry.action, reason: entry.reason, createdAt: entry.createdAt })),
      users: users.map(user => ({
        id: user.id, name: user.name, email: user.email,
        canApproveWarehouseAdjustments: user.warehousePermission?.canApproveWarehouseAdjustments === true,
      })),
    });
  } catch (error) {
    if (error instanceof CorporateAuthenticationRequired) return NextResponse.json({ error: "Inicia sesión para continuar." }, { status: 401 });
    return NextResponse.json({ error: "No fue posible consultar permisos." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireCorporateUser();
    const parsed = changeSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Datos inválidos. Se requiere motivo de al menos 10 caracteres." }, { status: 400 });
    const { userId, canApproveWarehouseAdjustments, reason } = parsed.data;
    const result = await db.$transaction(async tx => {
      const access = await tx.warehousePermission.findUnique({
        where: { userId: actor.id },
        select: { canManageAdjustmentPermissions: true },
      });
      if (access?.canManageAdjustmentPermissions !== true) return { status: 403 as const };
      const target = await tx.user.findUnique({ where: { id: userId }, select: { active: true } });
      if (!target?.active) return { status: 404 as const };
      const previous = await tx.warehousePermission.findUnique({
        where: { userId },
        select: { canApproveWarehouseAdjustments: true },
      });
      const oldValue = previous?.canApproveWarehouseAdjustments === true;
      if (oldValue === canApproveWarehouseAdjustments) return { status: 200 as const, changed: false };
      await tx.warehousePermission.upsert({
        where: { userId },
        create: { userId, canApproveWarehouseAdjustments },
        update: { canApproveWarehouseAdjustments },
      });
      await tx.warehousePermissionAudit.create({
        data: {
          actorId: actor.id, targetUserId: userId,
          action: canApproveWarehouseAdjustments ? "GRANT_ADJUSTMENT_APPROVAL" : "REVOKE_ADJUSTMENT_APPROVAL",
          oldValue, newValue: canApproveWarehouseAdjustments, reason,
        },
      });
      return { status: 200 as const, changed: true };
    });
    if (result.status === 403) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    if (result.status === 404) return NextResponse.json({ error: "Usuario no encontrado o inactivo." }, { status: 404 });
    return NextResponse.json({ changed: result.changed });
  } catch (error) {
    if (error instanceof CorporateAuthenticationRequired) return NextResponse.json({ error: "Inicia sesión para continuar." }, { status: 401 });
    return NextResponse.json({ error: "No fue posible actualizar el permiso." }, { status: 500 });
  }
}
