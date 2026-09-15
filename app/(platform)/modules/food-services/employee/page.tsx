import {
  ShieldCheck,
  Sparkles,
  Utensils,
} from "lucide-react";

import EmployeePortalAccess from "@/components/food-services/employee-portal-access";
import { getCurrentCorporateUser } from "@/lib/auth/corporate-auth";

export const dynamic = "force-dynamic";

export default async function EmployeeFoodPortalPage() {
  const corporateUser = await getCurrentCorporateUser();

  const corporateEmployee = corporateUser?.employee
    ? {
        employeeNumber: corporateUser.employee.employeeNumber,
        fullName: corporateUser.employee.fullName,
      }
    : null;

  return (
    <div className="mx-auto max-w-lg py-2">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <div className="relative overflow-hidden bg-[#0b3a82] px-6 py-8 sm:px-8">
          <div className="absolute -right-12 -top-12 size-40 rounded-full bg-white/5" />
          <div className="absolute -bottom-16 right-12 size-32 rounded-full bg-[#f4b400]/10" />

          <div className="relative">
            <div className="flex items-center justify-between gap-4">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-white/10 text-[#f4b400] ring-1 ring-white/10">
                <Utensils className="size-6" />
              </span>

              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-blue-50">
                <Sparkles className="size-3.5 text-[#f4b400]" />
                YellowFlex Food Services
              </span>
            </div>

            <h1 className="mt-6 text-3xl font-bold tracking-tight text-white">
              Mi menú
            </h1>

            <p className="mt-2 max-w-md text-sm leading-6 text-blue-100">
              Consulta el menú disponible, selecciona tus alimentos y administra
              tus reservas desde un solo lugar.
            </p>
          </div>
        </div>

        <div className="p-6 sm:p-8">
          <EmployeePortalAccess
            corporateEmployee={corporateEmployee}
          />

          <div className="mt-7 flex gap-3 border-t border-slate-100 pt-5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#0b3a82]">
              <ShieldCheck className="size-4" />
            </span>

            <div>
              <p className="text-xs font-semibold text-slate-600">
                Acceso protegido
              </p>

              <p className="mt-1 text-xs leading-5 text-slate-400">
                Las credenciales se validan de forma segura en el servidor y
                nunca se muestran ni se almacenan directamente en pantalla.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}