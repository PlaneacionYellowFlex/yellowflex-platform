import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { requireFoodEmployee } from "@/lib/food-services/self-service";
export const runtime = "nodejs";
export async function POST() {
  try {
    const { employee } = await requireFoodEmployee();
    return NextResponse.json({ data: { authenticated: true, employee: { employeeNumber: employee.employeeNumber, fullName: employee.fullName } } });
  } catch (error) { return apiError(error); }
}
