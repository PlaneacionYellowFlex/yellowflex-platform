import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { requireCpanelAdministrator } from "@/lib/cpanel/delegation";
import { db } from "@/lib/db";

export const runtime = "nodejs";
const createSchema = z.object({ employeeId: z.string().min(1), role: z.enum(["EMPLEADO", "PRODUCCION"]) }).strict();
const resetSchema = z.object({ userId: z.string().min(1) }).strict();

export async function GET() {
  try {
    await requireCpanelAdministrator();
    const employees = await db.employee.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, employeeNumber: true, fullName: true, corporateUserId: true,
        corporateUser: { select: { id: true, email: true, active: true, passwordMustChange: true, roles: { select: { role: true } } } },
        department: { select: { name: true } } },
      orderBy: { fullName: "asc" },
    });
    return NextResponse.json({ employees }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const { actor } = await requireCpanelAdministrator();
    const input = createSchema.parse(await request.json());
    const initialPassword = randomBytes(24).toString("base64url");
    const passwordHash = await bcrypt.hash(initialPassword, 12);
    const result = await db.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: input.employeeId },
        select: { id: true, employeeNumber: true, fullName: true, status: true, corporateUserId: true } });
      if (!employee || employee.status !== "ACTIVE" || employee.corporateUserId) return null;
      const user = await tx.user.create({ data: { name: employee.fullName, email: null,
        passwordHash, passwordMustChange: true, roles: { create: [{ role: input.role }] } }, select: { id: true } });
      await tx.employee.update({ where: { id: employee.id }, data: { corporateUserId: user.id } });
      return { userId: user.id, employeeNumber: employee.employeeNumber };
    });
    if (!result) return NextResponse.json({ error: "Colaborador inactivo o con cuenta existente." }, { status: 409 });
    console.info("EMPLOYEE_ACCOUNT_CREATED", { actorId: actor.id, targetUserId: result.userId });
    return NextResponse.json({ ...result, initialPassword }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const { actor } = await requireCpanelAdministrator();
    const { userId } = resetSchema.parse(await request.json());
    if (actor.id === userId) return NextResponse.json({ error: "No puedes restablecer tu propia contraseña." }, { status: 403 });
    const target = await db.user.findUnique({ where: { id: userId },
      select: { active: true, employee: { select: { status: true } }, roles: { select: { role: true } } } });
    if (!target || !target.active || target.employee?.status !== "ACTIVE" ||
      !target.employee || !target.roles.length || target.roles.some((r) => !["EMPLEADO", "PRODUCCION"].includes(r.role))) {
      return NextResponse.json({ error: "Solo se pueden restablecer cuentas operativas activas." }, { status: 403 });
    }
    const initialPassword = randomBytes(24).toString("base64url");
    const passwordHash = await bcrypt.hash(initialPassword, 12);
    await db.$transaction([
      db.user.update({ where: { id: userId }, data: { passwordHash, passwordMustChange: true, passwordUpdatedAt: new Date() } }),
      db.corporateSession.deleteMany({ where: { userId } }),
    ]);
    console.info("EMPLOYEE_PASSWORD_RESET", { actorId: actor.id, targetUserId: userId });
    return NextResponse.json({ initialPassword }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
