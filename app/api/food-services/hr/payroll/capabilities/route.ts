import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { requireFoodServicesRhAccess } from "@/lib/food-services/rh-authorization";
import { getPayrollCapabilities } from "@/lib/food-services/payroll-batch-operations";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireFoodServicesRhAccess();
    return NextResponse.json({ capabilities: await getPayrollCapabilities(user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
