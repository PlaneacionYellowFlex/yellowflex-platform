import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { destroyCorporateSession } from "@/lib/auth/corporate-auth";

export const runtime = "nodejs";

export async function POST() {
  try {
    await destroyCorporateSession();

    return NextResponse.json({
      data: {
        success: true,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}