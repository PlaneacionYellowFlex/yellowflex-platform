import { getOeeData } from "@/repositories/oee.repository";

export async function GET(request: Request) {
  try {
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
