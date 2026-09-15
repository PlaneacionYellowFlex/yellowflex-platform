import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireCorporateRole } from "@/lib/auth/corporate-auth";
import { updateEmployeeProfile } from "@/lib/rrhh/service";
import { employeeProfileSchema } from "@/lib/rrhh/validation";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PUT(
  request: Request,
  context: RouteContext,
) {
  try {
    await requireCorporateRole(["RH"]);
    const { id } = await context.params;
    const input = employeeProfileSchema.parse(await request.json());

    const profile = await updateEmployeeProfile(id, input);

    return NextResponse.json({
      data: profile,
    });
  } catch (error) {
    return apiError(error);
  }
}