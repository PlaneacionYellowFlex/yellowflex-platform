import Link from "next/link";
import { ArrowRight, LockKeyhole, Users } from "lucide-react";

export default function CPanelPage() {
  return (
    <div className="space-y-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-8">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-700">YellowFlex Platform</p>
        <h1 className="mt-2 text-3xl font-bold text-[#0b3a82]">C-PANEL</h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-600">
          Centro corporativo de accesos. Los módulos son visibles para todos;
          las acciones requieren autorización del perfil correspondiente.
        </p>
      </header>
      <section className="grid gap-5 md:grid-cols-2">
        <Link href="/settings/corporate-access" className="group rounded-2xl border border-slate-200 bg-white p-7 transition hover:border-blue-300 hover:shadow-md">
          <Users className="size-7 text-[#0b3a82]" />
          <h2 className="mt-4 text-lg font-bold text-slate-900">Usuarios y perfiles</h2>
          <p className="mt-2 text-sm text-slate-600">RH administra los accesos corporativos desde los perfiles de colaboradores.</p>
          <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#0b3a82]">Abrir módulo <ArrowRight className="size-4" /></span>
        </Link>
        <Link href="/c-panel/warehouse-adjustments" className="group rounded-2xl border border-slate-200 bg-white p-7 transition hover:border-amber-300 hover:shadow-md">
          <LockKeyhole className="size-7 text-amber-700" />
          <h2 className="mt-4 text-lg font-bold text-slate-900">Autorizaciones de inventario</h2>
          <p className="mt-2 text-sm text-slate-600">Consulta permisos de aprobación de ajustes y su historial de cambios.</p>
          <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#0b3a82]">Abrir módulo <ArrowRight className="size-4" /></span>
        </Link>
      </section>
    </div>
  );
}
