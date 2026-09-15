import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { requireCorporateRole } from "@/lib/auth/corporate-auth";
import { cancelExtraordinaryFoodService, createExtraordinaryFoodService, getExtraordinaryFoodServices } from "@/lib/food-services/extraordinary-service";
import { cancelExtraordinaryFoodServiceSchema, extraordinaryFoodServiceSchema } from "@/lib/food-services/validation";

export const runtime = "nodejs";

export async function GET() { try { await requireCorporateRole(["RH"]); return NextResponse.json({ data: await getExtraordinaryFoodServices() }); } catch (error) { return apiError(error); } }
export async function POST(request: Request) { try { const user = await requireCorporateRole(["RH"]); const input = extraordinaryFoodServiceSchema.parse(await request.json()); const record = await createExtraordinaryFoodService(input, user.id); return NextResponse.json({ data: { id: record.id } }, { status: 201 }); } catch (error) { return apiError(error); } }
export async function PATCH(request: Request) { try { await requireCorporateRole(["RH"]); const input = cancelExtraordinaryFoodServiceSchema.parse(await request.json()); await cancelExtraordinaryFoodService(input.id); return NextResponse.json({ data: { cancelled: true } }); } catch (error) { return apiError(error); } }
