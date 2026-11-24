import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireRhPermission } from "@/lib/cpanel/module-access";
import { getEmployees } from "@/lib/rrhh/service";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireRhPermission("view");
    const employees = await getEmployees();

    return NextResponse.json({
      data: employees,
    });
  } catch (error) {
    return apiError(error);
  }
}