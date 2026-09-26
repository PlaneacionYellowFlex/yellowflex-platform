"use client";

import type { WeeklyOeeRecord } from "./types";
import { formatPercent } from "./utils";

type Props = {
  history: WeeklyOeeRecord[];
  currentWeek: number;
};

const TARGET_OEE = 0.85;

function getPointColor(oee: number): string {
  if (oee >= TARGET_OEE) return "#16a34a";
  if (oee >= 0.65) return "#d6a800";
  return "#dc2626";
}

function getTrendLabel(variation: number | null): string {
  if (variation === null) return "Sin comparación";
  if (variation > 0.005) return "Tendencia positiva";
  if (variation < -0.005) return "Tendencia negativa";
  return "Comportamiento estable";
}

function getTrendStyles(variation: number | null): string {
  if (variation === null) return "border-slate-200 bg-slate-50 text-slate-600";
  if (variation > 0.005) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (variation < -0.005) return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function WeeklyHistory({ history, currentWeek }: Props) {
  const orderedHistory = [...history]
    .filter((record) => record.week <= currentWeek)
    .sort((a, b) => a.week - b.week);

  const latestRecord =
    orderedHistory.find((record) => record.week === currentWeek) ??
    orderedHistory.at(-1);

  const latestIndex = latestRecord
    ? orderedHistory.findIndex((record) => record.week === latestRecord.week)
    : -1;

  const previousRecord = latestIndex > 0 ? orderedHistory[latestIndex - 1] : null;

  const variation =
    latestRecord && previousRecord
      ? latestRecord.oee - previousRecord.oee
      : null;

  const bestRecord =
    orderedHistory.length > 0
      ? orderedHistory.reduce((best, record) =>
          record.oee > best.oee ? record : best,
        )
      : null;

  const chartWidth = 1000;
  const chartHeight = 320;
  const padding = { top: 28, right: 30, bottom: 48, left: 54 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  const xPosition = (index: number): number => {
    if (orderedHistory.length <= 1) return padding.left + plotWidth / 2;
    return padding.left + (index / (orderedHistory.length - 1)) * plotWidth;
  };

  const yPosition = (value: number): number =>
    padding.top + (1 - Math.min(Math.max(value, 0), 1)) * plotHeight;

  const linePoints = orderedHistory
    .map((record, index) => `${xPosition(index)},${yPosition(record.oee)}`)
    .join(" ");

  const areaPoints =
    orderedHistory.length > 0
      ? [
          `${xPosition(0)},${padding.top + plotHeight}`,
          ...orderedHistory.map(
            (record, index) => `${xPosition(index)},${yPosition(record.oee)}`,
          ),
          `${xPosition(orderedHistory.length - 1)},${padding.top + plotHeight}`,
        ].join(" ")
      : "";

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-6 sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.30em] text-[#d6a800]">
              Executive Trend
            </p>
            <h2 className="mt-2 text-2xl font-bold text-[#12355b]">
              Evolución semanal del OEE
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
              Comportamiento histórico del desempeño operativo contra la meta corporativa del 85%.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-[#12355b]">
              Semana {currentWeek}
            </span>
            <span className={`rounded-full border px-4 py-2 text-sm font-semibold ${getTrendStyles(variation)}`}>
              {getTrendLabel(variation)}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-b border-slate-100 px-6 py-6 sm:grid-cols-3 sm:px-8">
        <article className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">OEE actual</p>
          <p className="mt-3 text-3xl font-bold text-[#12355b]">
            {latestRecord ? formatPercent(latestRecord.oee) : "Sin datos"}
          </p>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Variación semanal</p>
          <p className={`mt-3 text-3xl font-bold ${variation === null ? "text-slate-400" : variation >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {variation === null ? "Sin dato" : `${variation >= 0 ? "+" : ""}${(variation * 100).toFixed(1)} pp`}
          </p>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Mejor semana</p>
          <p className="mt-3 text-3xl font-bold text-[#12355b]">
            {bestRecord ? formatPercent(bestRecord.oee) : "Sin datos"}
          </p>
          {bestRecord && <p className="mt-1 text-sm text-slate-400">Semana {bestRecord.week}</p>}
        </article>
      </div>

      <div className="px-4 py-6 sm:px-8 sm:py-8">
        {orderedHistory.length === 0 ? (
          <div className="flex min-h-72 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50">
            <p className="text-sm font-medium text-slate-500">No existe histórico disponible para mostrar.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              role="img"
              aria-label="Gráfica histórica del OEE semanal"
              className="min-w-[760px]"
            >
              <defs>
                <linearGradient id="oee-area-gradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#12355b" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#12355b" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {[0, 0.25, 0.5, 0.75, 1].map((value) => {
                const y = yPosition(value);
                return (
                  <g key={value}>
                    <line x1={padding.left} x2={chartWidth - padding.right} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                    <text x={padding.left - 12} y={y + 4} textAnchor="end" fontSize="12" fill="#94a3b8">
                      {Math.round(value * 100)}%
                    </text>
                  </g>
                );
              })}

              <line
                x1={padding.left}
                x2={chartWidth - padding.right}
                y1={yPosition(TARGET_OEE)}
                y2={yPosition(TARGET_OEE)}
                stroke="#d6a800"
                strokeWidth="2"
                strokeDasharray="8 8"
              />
              <text
                x={chartWidth - padding.right}
                y={yPosition(TARGET_OEE) - 10}
                textAnchor="end"
                fontSize="12"
                fontWeight="700"
                fill="#b38d00"
              >
                Meta 85%
              </text>

              <polygon points={areaPoints} fill="url(#oee-area-gradient)" />
              <polyline
                points={linePoints}
                fill="none"
                stroke="#12355b"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {orderedHistory.map((record, index) => {
                const x = xPosition(index);
                const y = yPosition(record.oee);
                const isCurrent = record.week === currentWeek;

                return (
                  <g key={record.week}>
                    <circle
                      cx={x}
                      cy={y}
                      r={isCurrent ? 9 : 6}
                      fill={getPointColor(record.oee)}
                      stroke="#ffffff"
                      strokeWidth="4"
                    />
                    <text x={x} y={y - 16} textAnchor="middle" fontSize="12" fontWeight="700" fill="#475569">
                      {formatPercent(record.oee)}
                    </text>
                    <text
                      x={x}
                      y={chartHeight - 18}
                      textAnchor="middle"
                      fontSize="12"
                      fontWeight={isCurrent ? "700" : "500"}
                      fill={isCurrent ? "#12355b" : "#94a3b8"}
                    >
                      S{record.week}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold text-slate-500">
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />Meta alcanzada</span>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#d6a800]" />Atención</span>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-red-600" />Crítico</span>
        </div>
      </div>
    </section>
  );
}