import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireRhPermission } from "@/lib/cpanel/module-access";
import { getRrhhCatalogs } from "@/lib/rrhh/service";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireRhPermission("view");
    const catalogs = await getRrhhCatalogs();

    return NextResponse.json({
      data: catalogs,
    });
  } catch (error) {
    return apiError(error);
  }
}