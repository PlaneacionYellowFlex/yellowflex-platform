import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireCorporateRole } from "@/lib/auth/corporate-auth";
import { getEmployees } from "@/lib/rrhh/service";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireCorporateRole(["RH"]);
    const employees = await getEmployees();

    return NextResponse.json({
      data: employees,
    });
  } catch (error) {
    return apiError(error);
  }
}