import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { getEmployeeSession } from "@/lib/food-services/employee-session";
import { confirmWeeklyOrder } from "@/lib/food-services/service";
import { weeklyReservationSchema } from "@/lib/food-services/validation";

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

    const input = weeklyReservationSchema.parse(
      await request.json(),
    );

    const order = await confirmWeeklyOrder(
      session.employee.id,
      input.menuItemIds,
    );

    return NextResponse.json(
      {
        data: {
          id: order.id,
          weekStart: order.weekStart,
          status: order.status,
          itemCount: order.itemCount,
          unitPrice: order.unitPrice,
          totalAmount: order.totalAmount,
          confirmedAt: order.confirmedAt,
          isConfirmed: true,
        },
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    return apiError(error);
  }
}