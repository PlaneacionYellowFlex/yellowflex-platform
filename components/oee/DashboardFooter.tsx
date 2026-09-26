"use client";

import { formatDate } from "./utils";

type Props = {
  sourceFile: string;
  sourceSheet: string;
  updatedAt: string;
  lastSync: Date | null;
  nextSync: Date | null;
};

export default function DashboardFooter({
  sourceFile,
  sourceSheet,
  updatedAt,
  lastSync,
  nextSync,
}: Props) {
  return (
    <footer className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">

        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
            Fuente Oficial
          </p>

          <p className="mt-3 font-semibold text-[#12355b]">
            {sourceFile}
          </p>

          <p className="mt-1 text-sm text-slate-500">
            Hoja {sourceSheet}
          </p>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
            Última Actualización del Archivo
          </p>

          <p className="mt-3 font-semibold text-[#12355b]">
            {formatDate(updatedAt)}
          </p>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
            Última Sincronización
          </p>

          <p className="mt-3 font-semibold text-[#12355b]">
            {lastSync
              ? lastSync.toLocaleString("es-MX")
              : "--"}
          </p>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
            Próxima Sincronización
          </p>

          <p className="mt-3 font-semibold text-[#12355b]">
            {nextSync
              ? nextSync.toLocaleString("es-MX")
              : "--"}
          </p>
        </div>

      </div>
    </footer>
  );
}