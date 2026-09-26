"use client";

type Props = {
  totalMachines: number;
  activeMachines: number;
  inactiveMachines: number;
  machinesWithUnclassifiedTime: number;
};

type Card = {
  title: string;
  value: number;
  description: string;
};

export default function KpiCards({
  totalMachines,
  activeMachines,
  inactiveMachines,
  machinesWithUnclassifiedTime,
}: Props) {
  const cards: Card[] = [
    {
      title: "Máquinas Analizadas",
      value: totalMachines,
      description: "Equipos considerados en la semana activa.",
    },
    {
      title: "Máquinas Activas",
      value: activeMachines,
      description: "Presentaron tiempo disponible registrado.",
    },
    {
      title: "Máquinas Inactivas",
      value: inactiveMachines,
      description: "Sin tiempo disponible durante la semana.",
    },
    {
      title: "Con Tiempo No Clasificado",
      value: machinesWithUnclassifiedTime,
      description: "Requieren revisión de captura o causa de paro.",
    },
  ];

  return (
    <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <article
          key={card.title}
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
        >
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
            {card.title}
          </p>

          <h2 className="mt-4 text-5xl font-bold tracking-tight text-[#12355b]">
            {card.value.toLocaleString("es-MX")}
          </h2>

          <p className="mt-3 text-sm leading-6 text-slate-500">
            {card.description}
          </p>
        </article>
      ))}
    </section>
  );
}