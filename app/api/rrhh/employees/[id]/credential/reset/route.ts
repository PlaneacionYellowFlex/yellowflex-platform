import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireRhPermission } from "@/lib/cpanel/module-access";
import { resetEmployeePin } from "@/lib/rrhh/credential-service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(
  _request: Request,
  context: RouteContext,
) {
  try {
    await requireRhPermission("manage");
    const { id } = await context.params;

    const credential = await resetEmployeePin(id);

    return NextResponse.json({
      data: credential,
    });
  } catch (error) {
    return apiError(error);
  }
}