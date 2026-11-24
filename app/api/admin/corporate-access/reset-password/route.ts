import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { apiError } from "@/lib/api-response";
import {
  CorporateAuthorizationRequired,
  requireCorporateUser,
} from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({ userId: z.string().min(1) }).strict();

export async function POST(request: Request) {
  try {
    const actor = await requireCorporateUser();
    if (!actor.roles.includes("ADMIN")) {
      throw new CorporateAuthorizationRequired(
        "Solo Administrador puede restablecer contraseñas corporativas.",
      );
    }

    const input = schema.parse(await request.json());
    if (input.userId === actor.id) {
      return NextResponse.json(
        { error: "No puedes restablecer tu propia contraseña desde esta función." },
        { status: 422 },
      );
    }

    const target = await db.user.findUnique({
      where: { id: input.userId },
      select: { id: true, active: true, name: true },
    });
    if (!target) {
      return NextResponse.json({ error: "La cuenta no existe." }, { status: 404 });
    }
    if (!target.active) {
      return NextResponse.json(
        { error: "La cuenta está inactiva. Actívala antes de restablecer la contraseña." },
        { status: 422 },
      );
    }

    const initialPassword = randomBytes(24).toString("base64url");
    const passwordHash = await bcrypt.hash(initialPassword, 12);

    await db.$transaction([
      db.user.update({
        where: { id: target.id },
        data: {
          passwordHash,
          passwordMustChange: true,
          passwordUpdatedAt: new Date(),
        },
      }),
      db.corporateSession.deleteMany({ where: { userId: target.id } }),
    ]);

    // Registro técnico sin incluir la contraseña temporal ni su hash.
    console.info("CORPORATE_PASSWORD_RESET", {
      actorId: actor.id,
      targetUserId: target.id,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(
      { ok: true, initialPassword },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
