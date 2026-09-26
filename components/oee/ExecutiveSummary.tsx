"use client";

import type {
  OeeInsight,
  OeeRanking,
  OeeSummary,
} from "./types";

import { formatPercent } from "./utils";

type Props = {
  summary: OeeSummary;
  ranking: OeeRanking;
  insights: OeeInsight[];
};

export default function ExecutiveSummary({
  summary,
  ranking,
  insights,
}: Props) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">

      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#d6a800]">
            Executive Intelligence
          </p>

          <h2 className="mt-2 text-2xl font-bold text-[#12355b]">
            Resumen Ejecutivo
          </h2>
        </div>

        <div className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
          Semana {summary.currentWeek}
        </div>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-3">

        <article className="rounded-2xl bg-[#f8fbff] p-6">
          <p className="text-xs font-bold uppercase tracking-[0.20em] text-slate-500">
            Utilización Promedio
          </p>

          <p className="mt-4 text-5xl font-bold text-[#12355b]">
            {formatPercent(summary.averageUtilization)}
          </p>
        </article>

        <article className="rounded-2xl bg-[#fffaf1] p-6">
          <p className="text-xs font-bold uppercase tracking-[0.20em] text-slate-500">
            Mejor Utilización
          </p>

          <h3 className="mt-4 text-xl font-bold text-[#12355b]">
            {ranking.highestUtilization[0]?.machine ?? "--"}
          </h3>

          <p className="mt-2 text-sm text-slate-500">
            {ranking.highestUtilization[0]
              ? formatPercent(
                  ranking.highestUtilization[0].utilization,
                )
              : "--"}
          </p>
        </article>

        <article className="rounded-2xl bg-[#fff5f5] p-6">
          <p className="text-xs font-bold uppercase tracking-[0.20em] text-slate-500">
            Menor Utilización
          </p>

          <h3 className="mt-4 text-xl font-bold text-[#12355b]">
            {ranking.lowestUtilization[0]?.machine ?? "--"}
          </h3>

          <p className="mt-2 text-sm text-slate-500">
            {ranking.lowestUtilization[0]
              ? formatPercent(
                  ranking.lowestUtilization[0].utilization,
                )
              : "--"}
          </p>
        </article>

      </div>

      <div className="mt-8">

        <h3 className="text-lg font-bold text-[#12355b]">
          Hallazgos Automáticos
        </h3>

        <div className="mt-5 space-y-3">

          {insights.length === 0 && (
            <div className="rounded-2xl border border-slate-200 p-5 text-slate-500">
              No existen hallazgos para la semana seleccionada.
            </div>
          )}

          {insights.map((item) => (
            <article
              key={item.id}
              className="rounded-2xl border border-slate-200 bg-white p-5"
            >
              <h4 className="font-bold text-[#12355b]">
                {item.title}
              </h4>

              <p className="mt-2 text-sm leading-6 text-slate-600">
                {item.message}
              </p>
            </article>
          ))}

        </div>

      </div>

    </section>
  );
}