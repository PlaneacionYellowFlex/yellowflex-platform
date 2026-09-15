import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import {
  createEmployeeSession,
  getEmployeeSession,
  invalidateEmployeeSessions,
} from "@/lib/food-services/employee-session";
import { changeEmployeePin } from "@/lib/food-services/service";
import { changeEmployeePinSchema } from "@/lib/food-services/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await getEmployeeSession();

    if (!session) {
      return NextResponse.json(
        {
          error: "Acceso de empleado requerido.",
        },
        {
          status: 401,
        },
      );
    }

    const input = changeEmployeePinSchema.parse(
      await request.json(),
    );

    const employeeId = session.employee.id;

    const result = await changeEmployeePin(
      employeeId,
      input.newPin,
    );

    await invalidateEmployeeSessions(employeeId);
    await createEmployeeSession(employeeId);

    return NextResponse.json({
      data: {
        changed: true,
        pinMustChange: result.pinMustChange,
        pinUpdatedAt: result.pinUpdatedAt,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}