import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import { requireCpanelAdministrator } from "@/lib/cpanel/delegation";
import { db } from "@/lib/db";
import { isOrdinaryWarehouseFlag, WAREHOUSE_LEGACY_FLAGS, WAREHOUSE_ORDINARY_FLAGS } from "@/lib/warehouse/capabilities";

export const runtime = "nodejs";

/**
 * YF-003 · Permisos operativos de Almacén administrados desde C-PANEL.
 *  - ADMIN: todos los permisos operativos (ordinarios y sensibles), de cualquier usuario excepto de sí mismo.
 *  - RH con delegación expresa de C-PANEL (c-panel/manage): solo los ORDINARIOS (consultar, registrar movimientos), nunca
 *    sobre sí mismo ni sobre cuentas ADMIN o DIRECCIÓN. El rol RH por sí solo no administra nada.
 *  - Sensibles (investigar, aprobar ajustes, carga inicial, catálogo): reservados a ADMIN.
 * Cada cambio queda en la auditoría corporativa (moduleKey "warehouse", actionKey "operativo:<permiso>") con actor, usuario
 * afectado, valor anterior, valor nuevo, fecha y motivo obligatorio. La revocación surte efecto en la siguiente solicitud del
 * usuario (las capacidades se leen de la base de datos en cada operación, sin caché).
 */
const querySchema = z.object({ userId: z.string().min(1) });
const changeSchema = z.object({
  userId: z.string().min(1),
  flag: z.enum(WAREHOUSE_LEGACY_FLAGS),
  granted: z.boolean(),
  reason: z.string().trim().min(5).max(500),
}).strict();

const EMPTY = Object.fromEntries(WAREHOUSE_LEGACY_FLAGS.map(f => [f, false])) as Record<(typeof WAREHOUSE_LEGACY_FLAGS)[number], boolean>;
const PROTECTED_ROLES = ["ADMIN", "DIRECCION"];

export async function GET(request: Request) {
  try {
    const { actor, scope } = await requireCpanelAdministrator();
    const { userId } = querySchema.parse({ userId: new URL(request.url).searchParams.get("userId") });
    if (scope === "rh") {
      const target = await db.user.findUnique({ where: { id: userId }, select: { roles: { select: { role: true } } } });
      if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
      if (userId === actor.id || target.roles.some(r => PROTECTED_ROLES.includes(r.role))) {
        return NextResponse.json({ error: "No puedes administrar esta cuenta" }, { status: 403 });
      }
    }
    const row = await db.warehousePermission.findUnique({ where: { userId } });
    const flags = { ...EMPTY };
    if (row) for (const f of WAREHOUSE_LEGACY_FLAGS) flags[f] = row[f] === true;
    const editable = scope === "admin" ? [...WAREHOUSE_LEGACY_FLAGS] : [...WAREHOUSE_ORDINARY_FLAGS];
    return NextResponse.json({ flags, scope, editable }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const { actor, scope } = await requireCpanelAdministrator();
    const input = changeSchema.parse(await request.json());
    if (input.userId === actor.id) {
      return NextResponse.json({ error: "No puedes cambiar tus propios permisos; solicita el cambio a otro administrador." }, { status: 403 });
    }
    if (scope === "rh" && !isOrdinaryWarehouseFlag(input.flag)) {
      return NextResponse.json({ error: "Este permiso de Almacén es sensible y está reservado a ADMIN." }, { status: 403 });
    }
    const result = await db.$transaction(async tx => {
      // Bloqueo de la fila del usuario: dos cambios simultáneos se registran en orden y ambos quedan auditados.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
      const target = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, active: true, roles: { select: { role: true } } } });
      if (!target) return { status: 404, error: "Usuario no encontrado" } as const;
      if (scope === "rh" && target.roles.some(r => PROTECTED_ROLES.includes(r.role))) {
        return { status: 403, error: "RH no puede modificar permisos de Dirección o ADMIN" } as const;
      }
      if (!target.active && input.granted) return { status: 422, error: "No se pueden conceder permisos a usuarios inactivos" } as const;
      const current = await tx.warehousePermission.findUnique({ where: { userId: input.userId } });
      const old = current ? current[input.flag] === true : null;
      if ((old ?? false) === input.granted) return { status: 200, unchanged: true } as const;
      await tx.warehousePermission.upsert({
        where: { userId: input.userId },
        create: { userId: input.userId, [input.flag]: input.granted },
        update: { [input.flag]: input.granted },
      });
      await tx.corporatePermissionAudit.create({
        data: { actorId: actor.id, targetId: input.userId, moduleKey: "warehouse", actionKey: `operativo:${input.flag}`,
          oldGranted: old, newGranted: input.granted, reason: input.reason },
      });
      return { status: 200, flag: input.flag, granted: input.granted } as const;
    });
    return NextResponse.json(result, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
