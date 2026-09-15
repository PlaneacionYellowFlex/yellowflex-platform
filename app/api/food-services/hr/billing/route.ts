import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireCorporateRole } from "@/lib/auth/corporate-auth";
import { getHrBillingSummary } from "@/lib/food-services/hr-billing-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireCorporateRole(["RH"]);

    const billing = await getHrBillingSummary();

    return NextResponse.json({
      data: billing,
    });
  } catch (error) {
    return apiError(error);
  }
}