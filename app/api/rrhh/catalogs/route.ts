import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireCorporateRole } from "@/lib/auth/corporate-auth";
import { getRrhhCatalogs } from "@/lib/rrhh/service";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireCorporateRole(["RH"]);
    const catalogs = await getRrhhCatalogs();

    return NextResponse.json({
      data: catalogs,
    });
  } catch (error) {
    return apiError(error);
  }
}