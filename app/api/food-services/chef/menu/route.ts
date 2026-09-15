import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireCorporateRole } from "@/lib/auth/corporate-auth";
import { getChefProductionSummary } from "@/lib/food-services/chef-production-service";
import {
  getChefMenuHistory,
  getOrCreateNextMenuWeek,
  publishNextMenuWeek,
  saveNextMenuWeek,
} from "@/lib/food-services/chef-service";
import { chefWeeklyMenuSchema } from "@/lib/food-services/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireCorporateRole(["CHEF"]);

    const url = new URL(request.url);
    const view = url.searchParams.get("view");

    if (view === "history") {
      const history = await getChefMenuHistory();

      return NextResponse.json({
        data: history,
      });
    }

    if (view === "production") {
      const production =
        await getChefProductionSummary();

      return NextResponse.json({
        data: production,
      });
    }

    const menuWeek =
      await getOrCreateNextMenuWeek();

    return NextResponse.json({
      data: menuWeek,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireCorporateRole(["CHEF"]);

    const input = chefWeeklyMenuSchema.parse(
      await request.json(),
    );

    const menuWeek =
      await saveNextMenuWeek(input);

    return NextResponse.json({
      data: menuWeek,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST() {
  try {
    await requireCorporateRole(["CHEF"]);

    const result =
      await publishNextMenuWeek();

    return NextResponse.json({
      data: result,
    });
  } catch (error) {
    return apiError(error);
  }
}