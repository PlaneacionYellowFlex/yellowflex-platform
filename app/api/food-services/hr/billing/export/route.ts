import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireFoodServicesRhAccess } from "@/lib/food-services/rh-authorization";
import { exportFoodPayroll } from "@/lib/food-services/payroll-export";

export const runtime = "nodejs";

/** Repeatable informational report; GET and legacy POST are both read-only. */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  try {
    const actor = await requireFoodServicesRhAccess();

    const weekId = new URL(request.url).searchParams.get("weekId");

    if (!weekId) {
      return NextResponse.json(
        { error: "Debes indicar la semana que deseas exportar." },
        { status: 400 },
      );
    }

    const exportFile = await exportFoodPayroll(weekId, actor.id);

    return new Response(exportFile.body, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${exportFile.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
