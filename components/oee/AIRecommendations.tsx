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

export default function AIRecommendations({
  summary,
  ranking,
  insights,
}: Props) {
  const recommendations: string[] = [];

  if (summary.averageUtilization < 0.75) {
    recommendations.push(
      "Incrementar la utilización promedio de las máquinas mediante una revisión conjunta entre Planeación y Producción."
    );
  }

  if (ranking.lowestUtilization.length > 0) {
    recommendations.push(
      `Analizar la causa raíz de la baja utilización de ${ranking.lowestUtilization[0].machine}.`
    );
  }

  if (
    ranking.highestUtilization.length > 0 &&
    ranking.highestUtilization[0].utilization > 1
  ) {
    recommendations.push(
      `Validar la captura de tiempos de ${ranking.highestUtilization[0].machine}, ya que supera el 100% de utilización.`
    );
  }

  if (insights.length === 0) {
    recommendations.push(
      "No se detectaron anomalías relevantes durante la semana activa."
    );
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.30em] text-[#d6a800]">
            Artificial Intelligence
          </p>

          <h2 className="mt-2 text-2xl font-bold text-[#12355b]">
            Recomendaciones Ejecutivas
          </h2>
        </div>

        <div className="rounded-2xl bg-[#eef4fb] px-4 py-2 text-sm font-semibold text-[#12355b]">
          {recommendations.length} recomendaciones
        </div>
      </div>

      <div className="mt-8 space-y-4">
        {recommendations.map((recommendation, index) => (
          <article
            key={index}
            className="rounded-2xl border border-slate-200 bg-[#f8fbff] p-5"
          >
            <h3 className="font-semibold text-[#12355b]">
              Recomendación {index + 1}
            </h3>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              {recommendation}
            </p>
          </article>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-[#d6a800]/30 bg-[#fffdf5] p-6">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#d6a800]">
          Próxima Evolución IA
        </p>

        <p className="mt-3 text-sm leading-7 text-slate-600">
          Este módulo evolucionará para generar recomendaciones predictivas
          utilizando tendencias históricas, comportamiento por máquina,
          capacidad instalada, cumplimiento del plan y eventos de producción.
        </p>
      </div>
    </section>
  );
}