import { NextResponse } from "next/server";
import { z } from "zod";

import {
  authenticateCorporateUser,
  createCorporateSession,
} from "@/lib/auth/corporate-auth";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Ingresa un correo electrónico válido."),
  password: z
    .string()
    .min(1, "La contraseña es obligatoria.")
    .max(200),
});

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await request.json());

    const user = await authenticateCorporateUser(
      input.email,
      input.password,
    );

    await createCorporateSession(user.id);

    return NextResponse.json({
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          roles: user.roles,
          passwordMustChange: user.passwordMustChange,
        },
      },
    });
  } catch (error) {
    return apiError(error);
  }
}