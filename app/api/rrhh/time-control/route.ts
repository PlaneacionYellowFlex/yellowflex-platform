import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireCorporateRole } from "@/lib/auth/corporate-auth";
import { getTimeControlSummary } from "@/lib/rrhh/time-control-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireCorporateRole(["RH"]);
    const summary = await getTimeControlSummary();

    return NextResponse.json({
      data: summary,
    });
  } catch (error) {
    return apiError(error);
  }
}