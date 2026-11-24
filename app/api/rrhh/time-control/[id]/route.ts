import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireRhPermission } from "@/lib/cpanel/module-access";
import {
  getEmployeeTimeHistory,
  registerEmployeeTimeMovement,
} from "@/lib/rrhh/time-control-service";
import { employeeTimeMovementSchema } from "@/lib/rrhh/time-control-validation";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  try {
    await requireRhPermission("view");
    const { id } = await context.params;

    const history = await getEmployeeTimeHistory(id);

    return NextResponse.json({
      data: history,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
) {
  try {
    await requireRhPermission("operate");
    const { id } = await context.params;

    const input = employeeTimeMovementSchema.parse(
      await request.json(),
    );

    const result = await registerEmployeeTimeMovement(
      id,
      input,
      null,
    );

    return NextResponse.json(
      {
        data: result,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    return apiError(error);
  }
}