import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { apiError } from "@/lib/api-response";
import { requireCorporateUser, CorporateLoginError, destroyCorporateSession, createCorporateSession } from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";
export const runtime = "nodejs";
const schema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(14).max(200) }).strict();
export async function POST(request: Request) {
  try {
    const user = await requireCorporateUser();
    const input = schema.parse(await request.json());
    if (input.currentPassword === input.newPassword) return NextResponse.json({ error: "La contraseña nueva debe ser diferente." }, { status: 422 });
    const current = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
    if (!current?.passwordHash || !await bcrypt.compare(input.currentPassword, current.passwordHash)) throw new CorporateLoginError("La contraseña actual es incorrecta.");
    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    await db.$transaction([db.user.update({ where: { id: user.id }, data: { passwordHash, passwordMustChange: false, passwordUpdatedAt: new Date() } }), db.corporateSession.deleteMany({ where: { userId: user.id } })]);
    await destroyCorporateSession();
    await createCorporateSession(user.id);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
