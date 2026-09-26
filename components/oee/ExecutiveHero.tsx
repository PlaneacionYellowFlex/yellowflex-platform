"use client";

import { formatPercent } from "./utils";

type Props = {
  currentWeek: number;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
};

function getStatus(oee: number) {
  if (oee >= 0.8) {
    return {
      title: "Dentro del objetivo",
      description:
        "El desempeño operativo se encuentra dentro de la meta establecida.",
      color:
        "border-emerald-300 bg-emerald-50 text-emerald-700",
    };
  }

  if (oee >= 0.65) {
    return {
      title: "Seguimiento",
      description:
        "El desempeño operativo requiere seguimiento para alcanzar la meta.",
      color:
        "border-amber-300 bg-amber-50 text-amber-700",
    };
  }

  return {
    title: "Atención",
    description:
      "El desempeño operativo requiere acciones correctivas prioritarias.",
    color:
      "border-red-300 bg-red-50 text-red-700",
  };
}

export default function ExecutiveHero({
  currentWeek,
  oee,
  availability,
  performance,
  quality,
}: Props) {
  const status = getStatus(oee);

  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
      <div className="flex flex-col gap-8 lg:flex-row lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-[#d6a800]">
            Executive Overview
          </p>

          <h1 className="mt-3 text-5xl font-bold tracking-tight text-[#12355b]">
            {formatPercent(oee)}
          </h1>

          <p className="mt-3 text-slate-500">
            Semana activa {currentWeek}
          </p>
        </div>

        <div
          className={`max-w-md rounded-3xl border p-6 ${status.color}`}
        >
          <h2 className="text-xl font-bold">
            {status.title}
          </h2>

          <p className="mt-3 text-sm leading-6">
            {status.description}
          </p>
        </div>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl bg-slate-50 p-5">
          <p className="text-sm text-slate-500">
            Disponibilidad
          </p>

          <p className="mt-2 text-3xl font-bold text-[#12355b]">
            {formatPercent(availability)}
          </p>
        </div>

        <div className="rounded-2xl bg-slate-50 p-5">
          <p className="text-sm text-slate-500">
            Rendimiento
          </p>

          <p className="mt-2 text-3xl font-bold text-[#12355b]">
            {formatPercent(performance)}
          </p>
        </div>

        <div className="rounded-2xl bg-slate-50 p-5">
          <p className="text-sm text-slate-500">
            Calidad
          </p>

          <p className="mt-2 text-3xl font-bold text-[#12355b]">
            {formatPercent(quality)}
          </p>
        </div>
      </div>
    </section>
  );
}