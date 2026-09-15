"use client";

import {
  ArrowRight,
  BadgeCheck,
  LoaderCircle,
  UserRoundCheck,
} from "lucide-react";
import { useState } from "react";

type CorporateEmployeeAccessProps = {
  employee: {
    employeeNumber: string;
    fullName: string;
  };
  onAccessGranted: () => void;
};

export default function CorporateEmployeeAccess({
  employee,
  onAccessGranted,
}: CorporateEmployeeAccessProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string>();

  async function continueAsEmployee() {
    setIsLoading(true);
    setMessage(undefined);

    try {
      const response = await fetch(
        "/api/food-services/corporate-employee-access",
        {
          method: "POST",
        },
      );

      const payload = (await response.json()) as {
        data?: {
          authenticated: boolean;
          employee: {
            employeeNumber: string;
            fullName: string;
          };
        };
        error?: string;
      };

      if (!response.ok || !payload.data?.authenticated) {
        throw new Error(
          payload.error ??
            "No fue posible iniciar tu sesión como colaborador.",
        );
      }

      onAccessGranted();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No fue posible iniciar tu sesión como colaborador.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-[#0b3a82]/10 bg-gradient-to-br from-blue-50/80 to-white">
      <div className="p-5">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#0b3a82] text-[#f4b400] shadow-sm">
            <UserRoundCheck className="size-5" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-slate-900">
                Sesión corporativa detectada
              </p>

              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                <BadgeCheck className="size-3" />
                Verificada
              </span>
            </div>

            <p className="mt-2 truncate text-sm font-semibold text-[#0b3a82]">
              {employee.fullName}
            </p>

            <p className="mt-0.5 text-xs text-slate-500">
              Colaborador #{employee.employeeNumber}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={continueAsEmployee}
          disabled={isLoading}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b3a82] px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#082f6b] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Iniciando...
            </>
          ) : (
            <>
              Continuar como colaborador
              <ArrowRight className="size-4" />
            </>
          )}
        </button>

        {message ? (
          <p className="mt-3 text-xs font-medium leading-5 text-red-600">
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}