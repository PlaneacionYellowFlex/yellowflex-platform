import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { requireFoodServicesRhAccess } from "@/lib/food-services/rh-authorization";
import { canCancelFoodOrder, cancelFoodOrder, requireFoodOrderCancellationAccess } from "@/lib/food-services/order-cancellation";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireFoodServicesRhAccess();
    const orders = await db.foodOrder.findMany({ orderBy: { confirmedAt: "desc" }, take: 100,
      select: { id: true, status: true, itemCount: true, payrollStatus: true,
        employee: { select: { fullName: true, employeeNumber: true } },
        menuWeek: { select: { weekStart: true } },
        cancellation: { select: { reason: true, createdAt: true, previousStatus: true, newStatus: true,
          actor: { select: { name: true } } } } } });
    return NextResponse.json({ orders, canCancel: await canCancelFoodOrder(user) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    await requireFoodServicesRhAccess();
    const actor = await requireFoodOrderCancellationAccess();
    await cancelFoodOrder(actor, await request.json());
    return NextResponse.json({ cancelled: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
