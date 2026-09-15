import type { ReactNode } from "react";

export default function PageHeader({ eyebrow = "YellowFlex Platform", title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return <div className="flex flex-col gap-5 border-b border-slate-200 pb-7 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b27f00]">{eyebrow}</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-[#0b3a82] sm:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base">{description}</p></div>{action}</div>;
}
