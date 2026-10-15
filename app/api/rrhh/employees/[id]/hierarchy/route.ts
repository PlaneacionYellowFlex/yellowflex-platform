import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireCorporateRole } from "@/lib/auth/corporate-auth";
import {
  getEmployeeHierarchyCatalog,
  updateEmployeeHierarchy,
} from "@/lib/rrhh/service";
import { employeeHierarchySchema } from "@/lib/rrhh/validation";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireCorporateRole(["RH"]);
    const { id } = await context.params;
    const data = await getEmployeeHierarchyCatalog(id);
    return NextResponse.json({ data });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireCorporateRole(["RH"]);
    const { id } = await context.params;
    const input = employeeHierarchySchema.parse(await request.json());
    const data = await updateEmployeeHierarchy(id, input, user.id);
    return NextResponse.json({ data });
  } catch (error) {
    return apiError(error);
  }
}
