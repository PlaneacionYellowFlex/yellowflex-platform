import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireCorporateUser } from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";
import { createEmployeeSession } from "@/lib/food-services/employee-session";

export const runtime = "nodejs";

export async function POST() {
  try {
    const corporateUser = await requireCorporateUser();

    const employee = await db.employee.findUnique({
      where: {
        corporateUserId: corporateUser.id,
      },
      select: {
        id: true,
        employeeNumber: true,
        fullName: true,
        status: true,
      },
    });

    if (!employee) {
      return NextResponse.json(
        {
          error:
            "Tu cuenta corporativa no está vinculada a un colaborador de YellowFlex.",
        },
        {
          status: 403,
        },
      );
    }

    if (employee.status !== "ACTIVE") {
      return NextResponse.json(
        {
          error:
            "El colaborador vinculado a esta cuenta no se encuentra activo.",
        },
        {
          status: 403,
        },
      );
    }

    await createEmployeeSession(employee.id);

    return NextResponse.json({
      data: {
        authenticated: true,
        employee: {
          employeeNumber: employee.employeeNumber,
          fullName: employee.fullName,
        },
      },
    });
  } catch (error) {
    return apiError(error);
  }
}