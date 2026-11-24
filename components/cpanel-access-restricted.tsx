import Link from "next/link";
import { LockKeyhole } from "lucide-react";

export default function CpanelAccessRestricted({ moduleName }: { moduleName: string }) {
  return (
    <section className="mx-auto mt-12 max-w-xl rounded-2xl border border-slate-200 bg-white px-8 py-12 text-center shadow-sm" role="alert">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-[#b58116]">
        <LockKeyhole className="h-7 w-7" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold text-[#0b3a82]">Acceso restringido</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Tu cuenta no tiene autorización para acceder a esta función de {moduleName}. Solicita
        los permisos correspondientes al administrador de accesos.
      </p>
      <Link href="/dashboard" className="mt-7 inline-flex rounded-xl bg-[#0b3a82] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#1454a8]">
        Volver al inicio
      </Link>
    </section>
  );
}
