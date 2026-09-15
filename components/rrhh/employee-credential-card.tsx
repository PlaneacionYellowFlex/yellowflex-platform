"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Copy,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

type EmployeeCredentialCardProps = {
  employeeId: string;
  employeeStatus: "ACTIVE" | "INACTIVE";
  pinMustChange: boolean;
  pinUpdatedAt: string | null;
};

type ResetCredentialResponse = {
  data?: {
    temporaryPin: string;
    pinMustChange: boolean;
    pinUpdatedAt: string;
  };
  error?: string;
};

export default function EmployeeCredentialCard({
  employeeId,
  employeeStatus,
  pinMustChange,
  pinUpdatedAt,
}: EmployeeCredentialCardProps) {
  const [resetting, setResetting] = useState(false);
  const [temporaryPin, setTemporaryPin] =
    useState<string | null>(null);
  const [currentMustChange, setCurrentMustChange] =
    useState(pinMustChange);
  const [currentUpdatedAt, setCurrentUpdatedAt] =
    useState(pinUpdatedAt);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleReset() {
    const confirmed = window.confirm(
      "Se invalidará el PIN actual y todas las sesiones activas de Food Services. ¿Deseas continuar?",
    );

    if (!confirmed) {
      return;
    }

    try {
      setResetting(true);
      setError(null);
      setTemporaryPin(null);
      setCopied(false);

      const response = await fetch(
        `/api/rrhh/employees/${employeeId}/credential/reset`,
        {
          method: "POST",
        },
      );

      const payload =
        (await response.json()) as ResetCredentialResponse;

      if (!response.ok || !payload.data) {
        throw new Error(
          payload.error ??
            "No fue posible restablecer la credencial.",
        );
      }

      setTemporaryPin(payload.data.temporaryPin);
      setCurrentMustChange(payload.data.pinMustChange);
      setCurrentUpdatedAt(payload.data.pinUpdatedAt);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible restablecer la credencial.",
      );
    } finally {
      setResetting(false);
    }
  }

  async function copyTemporaryPin() {
    if (!temporaryPin) {
      return;
    }

    await navigator.clipboard.writeText(temporaryPin);
    setCopied(true);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-[#0b3a82]" />
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b27f00]">
              Seguridad
            </p>
          </div>

          <h3 className="mt-3 text-lg font-bold text-slate-950">
            Credencial digital
          </h3>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Acceso personal del colaborador a los servicios
            digitales de YellowFlex.
          </p>
        </div>

        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            employeeStatus === "ACTIVE"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          {employeeStatus === "ACTIVE" ? "ACTIVA" : "INACTIVA"}
        </span>
      </div>

      <div className="mt-6 space-y-3 rounded-2xl bg-slate-50 p-4">
        <CredentialRow
          label="Food Services"
          value={
            employeeStatus === "ACTIVE"
              ? "Habilitado"
              : "Bloqueado"
          }
        />

        <CredentialRow
          label="Estado del PIN"
          value={
            currentMustChange
              ? "Cambio requerido"
              : "PIN personal"
          }
        />

        <CredentialRow
          label="Último cambio"
          value={formatDate(currentUpdatedAt)}
        />
      </div>

      {temporaryPin && (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center gap-2 text-amber-800">
            <KeyRound className="size-5" />
            <p className="text-sm font-bold">
              PIN temporal
            </p>
          </div>

          <p className="mt-2 text-sm leading-6 text-amber-700">
            Entrégalo únicamente al colaborador. Este PIN no
            podrá consultarse nuevamente desde RH.
          </p>

          <div className="mt-4 flex items-center gap-3">
            <div className="flex-1 rounded-xl border border-amber-200 bg-white px-4 py-3 text-center font-mono text-2xl font-black tracking-[0.3em] text-slate-950">
              {temporaryPin}
            </div>

            <button
              type="button"
              onClick={copyTemporaryPin}
              className="inline-flex size-12 items-center justify-center rounded-xl border border-amber-200 bg-white text-slate-700 transition hover:bg-amber-100"
              title="Copiar PIN temporal"
            >
              {copied ? (
                <CheckCircle2 className="size-5 text-emerald-600" />
              ) : (
                <Copy className="size-5" />
              )}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleReset}
        disabled={resetting || employeeStatus !== "ACTIVE"}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b3a82] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#082e68] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {resetting ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />
            Generando...
          </>
        ) : (
          <>
            <RefreshCw className="size-4" />
            Restablecer PIN
          </>
        )}
      </button>
    </section>
  );
}

function CredentialRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-slate-500">
        {label}
      </span>
      <span className="text-right text-sm font-bold text-slate-800">
        {value}
      </span>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return "Sin cambios registrados";
  }

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}