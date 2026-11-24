import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireChefPermission } from "@/lib/cpanel/module-access";
import { getChefProductionSummary } from "@/lib/food-services/chef-production-service";
import {
  getChefMenuHistory,
  getNextMenuWeek,
  publishNextMenuWeek,
  saveNextMenuWeek,
} from "@/lib/food-services/chef-service";
import { chefWeeklyMenuSchema } from "@/lib/food-services/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireChefPermission("view");

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
        await getChefProductionSummary(url.searchParams.get("weekId") || undefined);

      return NextResponse.json({
        data: production,
      });
    }

    const menuWeek =
      await getNextMenuWeek();

    return NextResponse.json({
      data: menuWeek,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireChefPermission("operate");

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
    await requireChefPermission("operate");

    const result =
      await publishNextMenuWeek();

    return NextResponse.json({
      data: result,
    });
  } catch (error) {
    return apiError(error);
  }
}