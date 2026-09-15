import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  CorporateAuthenticationRequired,
  CorporateAuthorizationRequired,
  CorporateLoginError,
} from "@/lib/auth/corporate-auth";
import { ChefServiceError } from "@/lib/food-services/chef-service";
import { FoodServiceError } from "@/lib/food-services/service";
import { RrhhServiceError } from "@/lib/rrhh/errors";

export function apiError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Datos de entrada inválidos.",
        details: error.flatten().fieldErrors,
      },
      {
        status: 422,
      },
    );
  }

  if (error instanceof CorporateLoginError) {
    return NextResponse.json(
      {
        error: error.message,
      },
      {
        status: 401,
      },
    );
  }

  if (error instanceof CorporateAuthenticationRequired) {
    return NextResponse.json(
      {
        error: error.message,
      },
      {
        status: 401,
      },
    );
  }

  if (error instanceof CorporateAuthorizationRequired) {
    return NextResponse.json(
      {
        error: error.message,
      },
      {
        status: 403,
      },
    );
  }

  if (error instanceof RrhhServiceError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
      },
      {
        status: error.status,
      },
    );
  }

  if (error instanceof FoodServiceError) {
    return NextResponse.json(
      {
        error: error.message,
      },
      {
        status: error.status,
      },
    );
  }

  if (error instanceof ChefServiceError) {
    return NextResponse.json(
      {
        error: error.message,
      },
      {
        status: error.status,
      },
    );
  }

  console.error(error);

  return NextResponse.json(
    {
      error: "No fue posible completar la operación.",
    },
    {
      status: 500,
    },
  );
}