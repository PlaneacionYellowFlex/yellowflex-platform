import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireRhPermission } from "@/lib/cpanel/module-access";
import { getTimeControlSummary } from "@/lib/rrhh/time-control-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireRhPermission("view");
    const summary = await getTimeControlSummary();

    return NextResponse.json({
      data: summary,
    });
  } catch (error) {
    return apiError(error);
  }
}