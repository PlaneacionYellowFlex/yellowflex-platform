import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getEmployeeSession } from "@/lib/food-services/employee-session";
import { registerConsumption } from "@/lib/food-services/service";
import { consumptionSchema } from "@/lib/food-services/validation";
export const runtime = "nodejs";
export async function POST(request: Request) { try { const session = await getEmployeeSession(); if (!session) return NextResponse.json({ error: "Acceso de empleado requerido." }, { status: 401 }); const input = consumptionSchema.parse(await request.json()); const consumption = await registerConsumption(session.employee.id, input.menuItemId, input.credentialType); return NextResponse.json({ data: { id: consumption.id, consumedAt: consumption.consumedAt } }, { status: 201 }); } catch (error) { return apiError(error); } }
