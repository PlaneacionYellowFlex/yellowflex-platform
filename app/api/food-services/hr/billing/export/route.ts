import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireCorporateRole } from "@/lib/auth/corporate-auth";
import { buildFoodServicesBillingExport } from "@/lib/food-services/billing-export-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireCorporateRole(["RH"]);

    const weekId = new URL(request.url).searchParams.get("weekId");

    if (!weekId) {
      return NextResponse.json(
        { error: "Debes indicar la semana que deseas exportar." },
        { status: 400 },
      );
    }

    const exportFile = await buildFoodServicesBillingExport(weekId);

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
