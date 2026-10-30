import Link from "next/link";
import { LockKeyhole } from "lucide-react";

type Props = {
  moduleName?: string;
  detail?: string;
};

export default function AccessRestricted({
  moduleName = "este módulo",
  detail = "Tu perfil no tiene autorización para realizar esta operación.",
}: Props) {
  return (
    <section role="status" className="rounded-3xl border border-amber-200 bg-white p-8 shadow-sm">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
        <LockKeyhole className="size-6" />
      </div>
      <p className="mt-5 text-xs font-bold uppercase tracking-widest text-amber-700">YellowFlex Platform · Seguridad</p>
      <h1 className="mt-2 text-2xl font-bold text-[#0b3a82]">Acceso restringido</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
        Puedes ver {moduleName} en la navegación, pero tu perfil no cuenta con los permisos necesarios. {detail}
      </p>
      <Link href="/dashboard" className="mt-6 inline-flex rounded-xl bg-[#0b3a82] px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800">
        Regresar al inicio
      </Link>
    </section>
  );
}
