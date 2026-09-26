import { ArrowRight, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";

import PageHeader from "@/components/page-header";
import { platformRoles } from "@/lib/access-control";

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Configuración"
        description="Administración central de usuarios, accesos y seguridad de YellowFlex Platform."
      />
      <section className="grid gap-5 lg:grid-cols-2">
        <Link href="/settings/corporate-access" className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-blue-200 hover:shadow-md sm:p-8">
          <div className="flex items-start justify-between gap-5">
            <span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-[#0b3a82]"><Users className="size-5" /></span>
            <ArrowRight className="size-5 text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#0b3a82]" />
          </div>
          <h2 className="mt-5 text-lg font-bold text-slate-900">Usuarios y accesos</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Busca colaboradores de RH, crea su acceso y modifica posteriormente su perfil, estado y permisos por módulo.</p>
        </Link>
        <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="flex gap-4">
            <span className="flex size-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><ShieldCheck className="size-5" /></span>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Perfiles técnicos disponibles</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">El puesto laboral permanece en RH. Estos perfiles controlan el acceso digital y no sustituyen el organigrama.</p>
              <div className="mt-5 flex flex-wrap gap-2">{platformRoles.map((role) => <span key={role} className="rounded-lg border bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{role}</span>)}</div>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}
