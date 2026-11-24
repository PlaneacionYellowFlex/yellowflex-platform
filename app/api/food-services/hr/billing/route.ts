import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireFoodServicesRhAccess } from "@/lib/food-services/rh-authorization";
import { getHrBillingSummary } from "@/lib/food-services/hr-billing-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireFoodServicesRhAccess();

    const billing = await getHrBillingSummary(undefined, undefined, new URL(request.url).searchParams.get("weekId") || undefined);

    return NextResponse.json({
      data: billing,
    });
  } catch (error) {
    return apiError(error);
  }
}