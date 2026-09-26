import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { getMyPurchasePermissions } from "@/lib/purchases/purchase-permissions";

export async function GET() {
  try {
    const permissions = await getMyPurchasePermissions();

    return NextResponse.json({ permissions });
  } catch (error) {
    return apiError(error);
  }
}
