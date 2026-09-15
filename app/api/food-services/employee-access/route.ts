import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { createEmployeeSession } from "@/lib/food-services/employee-session";
import { verifyEmployeePin } from "@/lib/food-services/service";
import { employeeAccessSchema } from "@/lib/food-services/validation";
export const runtime = "nodejs";
export async function POST(request: Request) { try { const input = employeeAccessSchema.parse(await request.json()); const employeeId = await verifyEmployeePin(input.employeeNumber, input.pin); await createEmployeeSession(employeeId); return NextResponse.json({ data: { authenticated: true } }); } catch (error) { return apiError(error); } }
