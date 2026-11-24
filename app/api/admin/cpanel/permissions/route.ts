import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireCpanelAdministrator, rhCanChange } from "@/lib/cpanel/delegation";
import { cpanelActions, cpanelModules, isFoodRhOnlyAction } from "@/lib/cpanel/permission-catalog";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const querySchema = z.object({ userId: z.string().min(1) });
const changeSchema = z.object({
  userId: z.string().min(1),
  moduleKey: z.enum(cpanelModules),
  actionKey: z.enum(cpanelActions),
  granted: z.boolean(),
  reason: z.string().trim().min(5).max(500),
}).strict();

export async function GET(request: Request) {
  try {
    const { actor, scope } = await requireCpanelAdministrator();
    const url = new URL(request.url);
    const { userId } = querySchema.parse({ userId: url.searchParams.get("userId") });
    const target = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, active: true, roles: { select: { role: true } } },
    });
    if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    if (scope === "rh" && (userId === actor.id || target.roles.some((r) => r.role === "ADMIN" || r.role === "DIRECCION"))) {
      return NextResponse.json({ error: "No puedes administrar esta cuenta" }, { status: 403 });
    }
    const [permissions, audit] = await Promise.all([
      db.corporateModulePermission.findMany({ where: { userId }, orderBy: [{ moduleKey: "asc" }, { actionKey: "asc" }] }),
      db.corporatePermissionAudit.findMany({ where: { targetId: userId }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    return NextResponse.json({ user: target, permissions, audit, scope }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const { actor, scope } = await requireCpanelAdministrator();
    const input = changeSchema.parse(await request.json());
    if (input.userId === actor.id && input.moduleKey === "c-panel") {
      return NextResponse.json({ error: "No puedes cambiar tus propios permisos C-PANEL" }, { status: 403 });
    }
    if (scope === "rh" && (!rhCanChange(input.moduleKey, input.actionKey) || input.userId === actor.id)) {
      return NextResponse.json({ error: "Esta autorización está reservada a Dirección/ADMIN" }, { status: 403 });
    }
    if (isFoodRhOnlyAction(input.actionKey) && input.moduleKey !== "food-services") {
      return NextResponse.json({ error: "Acción exclusiva de Food Services" }, { status: 422 });
    }
    const result = await db.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, active: true, roles: { select: { role: true } } },
      });
      if (!target) return { status: 404, error: "Usuario no encontrado" } as const;
      if (scope === "rh" && target.roles.some((r) => r.role === "ADMIN" || r.role === "DIRECCION")) {
        return { status: 403, error: "RH no puede modificar permisos de Dirección o ADMIN" } as const;
      }
      if (!target.active && input.granted) return { status: 422, error: "No se pueden conceder permisos a usuarios inactivos" } as const;
      // Solo ADMIN puede delegar c-panel/manage; únicamente a usuarios con rol RH.
      if (input.moduleKey === "c-panel" && input.actionKey === "manage" && input.granted &&
          !target.roles.some((r) => r.role === "RH")) {
        return { status: 422, error: "La delegación de C-PANEL requiere rol RH" } as const;
      }
      if (isFoodRhOnlyAction(input.actionKey) && input.granted && !target.roles.some(r => r.role === "RH")) {
        return { status: 422, error: input.actionKey === "cancel-food-order"
          ? "La cancelación excepcional requiere rol RH"
          : "La generación de prenómina requiere rol RH" } as const;
      }
      const key = { userId: input.userId, moduleKey: input.moduleKey, actionKey: input.actionKey };
      const current = await tx.corporateModulePermission.findUnique({ where: { userId_moduleKey_actionKey: key } });
      if (current?.granted === input.granted || (!current && !input.granted)) return { status: 200, unchanged: true } as const;
      const permission = await tx.corporateModulePermission.upsert({
        where: { userId_moduleKey_actionKey: key },
        create: { ...key, granted: input.granted }, update: { granted: input.granted },
      });
      await tx.corporatePermissionAudit.create({
        data: { actorId: actor.id, targetId: input.userId, moduleKey: input.moduleKey,
          actionKey: input.actionKey, oldGranted: current?.granted ?? null,
          newGranted: input.granted, reason: input.reason },
      });
      return { status: 200, permission } as const;
    });
    return NextResponse.json(result, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
