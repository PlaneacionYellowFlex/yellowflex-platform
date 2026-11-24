import { requireControlTowerAccess } from "@/lib/cpanel/module-access";
import { apiError } from "@/lib/api-response";
import { CorporateAuthenticationRequired, CorporateAuthorizationRequired } from "@/lib/auth/corporate-auth";
import { getOeeData } from "@/repositories/oee.repository";

export async function GET(request: Request) {
  try {
    await requireControlTowerAccess();
    const { searchParams } = new URL(request.url);

    const weekParameter = searchParams.get("week");

    const activeWeek =
      weekParameter !== null
        ? Number(weekParameter)
        : undefined;

    if (
      activeWeek !== undefined &&
      (!Number.isInteger(activeWeek) ||
        activeWeek < 1 ||
        activeWeek > 53)
    ) {
      return Response.json(
        {
          success: false,
          message: "La semana solicitada no es válida.",
        },
        {
          status: 400,
        },
      );
    }

    const data = await getOeeData(activeWeek);

    return Response.json(data);
  } catch (error) {
    if (error instanceof CorporateAuthenticationRequired || error instanceof CorporateAuthorizationRequired) return apiError(error);
    console.error("OEE API:", error);

    return Response.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "No fue posible leer el OEE.",
      },
      {
        status: 500,
      },
    );
  }
}
