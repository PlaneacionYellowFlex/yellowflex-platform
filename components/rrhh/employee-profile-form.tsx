"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Bus,
  CalendarDays,
  LoaderCircle,
  Mail,
  Phone,
  Save,
} from "lucide-react";

type ContractType =
  | "INDEFINITE"
  | "FIXED_TERM"
  | "TEMPORARY"
  | "TRAINING"
  | "OTHER";

type EmployeeProfileFormProps = {
  employeeId: string;
  initialData: {
    birthDate: string;
    hireDate: string;
    contractType: ContractType | null;
    phone: string;
    email: string;
    transportRoute: string;
  };
};

export default function EmployeeProfileForm({
  employeeId,
  initialData,
}: EmployeeProfileFormProps) {
  const router = useRouter();

  const [birthDate, setBirthDate] = useState(initialData.birthDate);
  const [hireDate, setHireDate] = useState(initialData.hireDate);
  const [contractType, setContractType] = useState<
    ContractType | ""
  >(initialData.contractType ?? "");
  const [phone, setPhone] = useState(initialData.phone);
  const [email, setEmail] = useState(initialData.email);
  const [transportRoute, setTransportRoute] = useState(
    initialData.transportRoute,
  );

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(
        `/api/rrhh/employees/${employeeId}/profile`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            birthDate,
            hireDate,
            contractType: contractType || null,
            phone,
            email,
            transportRoute,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("No fue posible guardar el expediente.");
      }

      setMessage("Expediente actualizado correctamente.");
      router.refresh();
    } catch {
      setError(
        "No fue posible guardar los cambios. Revisa la información e inténtalo nuevamente.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Fecha de nacimiento"
          icon={CalendarDays}
        >
          <input
            type="date"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
            className={inputClassName}
          />
        </FormField>

        <FormField
          label="Fecha de ingreso"
          icon={CalendarDays}
        >
          <input
            type="date"
            value={hireDate}
            onChange={(event) => setHireDate(event.target.value)}
            className={inputClassName}
          />
        </FormField>

        <FormField
          label="Tipo de contrato"
          icon={CalendarDays}
        >
          <select
            value={contractType}
            onChange={(event) =>
              setContractType(event.target.value as ContractType | "")
            }
            className={inputClassName}
          >
            <option value="">Sin información</option>
            <option value="INDEFINITE">Indeterminado</option>
            <option value="FIXED_TERM">Tiempo determinado</option>
            <option value="TEMPORARY">Temporal</option>
            <option value="TRAINING">Capacitación inicial</option>
            <option value="OTHER">Otro</option>
          </select>
        </FormField>

        <FormField label="Teléfono" icon={Phone}>
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={30}
            placeholder="Sin información"
            className={inputClassName}
          />
        </FormField>

        <FormField label="Correo electrónico" icon={Mail}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="correo@yellowflex.com"
            className={inputClassName}
          />
        </FormField>

        <FormField label="Ruta de transporte" icon={Bus}>
          <input
            type="text"
            value={transportRoute}
            onChange={(event) =>
              setTransportRoute(event.target.value)
            }
            maxLength={150}
            placeholder="Sin información"
            className={inputClassName}
          />
        </FormField>
      </div>

      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {message}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end border-t border-slate-100 pt-5">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-w-40 items-center justify-center gap-2 rounded-xl bg-[#0b3a82] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#082e68] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="size-4" />
              Guardar expediente
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function FormField({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof CalendarDays;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
        <Icon className="size-4 text-slate-400" />
        {label}
      </span>

      {children}
    </label>
  );
}

const inputClassName =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-300 focus:border-[#0b3a82] focus:ring-4 focus:ring-blue-50";