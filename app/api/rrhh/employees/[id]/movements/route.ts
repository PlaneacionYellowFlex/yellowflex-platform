import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireCorporateRole } from "@/lib/auth/corporate-auth";
import { createEmployeeMovement } from "@/lib/rrhh/service";
import { employeeMovementSchema } from "@/lib/rrhh/validation";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(
  request: Request,
  context: RouteContext,
) {
  try {
    await requireCorporateRole(["RH"]);
    const { id } = await context.params;
    const input = employeeMovementSchema.parse(
      await request.json(),
    );

    const movement = await createEmployeeMovement(
      id,
      input,
      null,
    );

    return NextResponse.json(
      {
        data: movement,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    return apiError(error);
  }
}