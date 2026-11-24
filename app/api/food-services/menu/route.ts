import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { requireFoodMenuUser } from "@/lib/food-services/self-service";
import { getPublishedMenu } from "@/lib/food-services/service";
export const runtime = "nodejs";
export async function GET() {
  try {
    await requireFoodMenuUser();
    return NextResponse.json({ data: await getPublishedMenu() });
  } catch (error) { return apiError(error); }
}
