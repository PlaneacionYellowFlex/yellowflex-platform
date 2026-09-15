import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getPublishedMenu } from "@/lib/food-services/service";
export const runtime = "nodejs";
export async function GET() { try { return NextResponse.json({ data: await getPublishedMenu() }); } catch (error) { return apiError(error); } }
