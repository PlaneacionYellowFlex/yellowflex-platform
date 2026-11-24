import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import CpanelPermissionEditor from "@/components/cpanel-permission-editor";
import { requireCpanelAdministrator } from "@/lib/cpanel/delegation";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ userId?: string }> };

export default async function CpanelRhPage({ searchParams }: Props) {
  const { actor, scope } = await requireCpanelAdministrator().catch(() => ({ actor: null, scope: null }));
  if (!actor || !scope) return (
    <section className="rounded-2xl border border-amber-200 bg-white p-8">
      <h1 className="text-2xl font-bold text-[#0b3a82]">Acceso restringido</h1>
      <p className="mt-2 text-slate-600">La administración de C-PANEL requiere delegación expresa de Dirección.</p>
    </section>
  );
  const users = await db.user.findMany({
    where: { active: true, ...(scope === "rh" ? { NOT: { roles: { some: { role: { in: ["ADMIN", "DIRECCION"] } } } } } : {}) },
    select: { id: true, name: true, email: true, roles: { select: { role: true } } },
    orderBy: { name: "asc" },
  });
  const eligible = scope === "rh" ? users.filter((u) => u.id !== actor.id) : users;
  const { userId } = await searchParams;
  const selected = eligible.find((u) => u.id === userId) ?? null;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3"><ShieldCheck className="text-[#0b3a82]" />
          <h1 className="text-2xl font-bold text-[#0b3a82]">C-PANEL · Administración delegada</h1></div>
        <p className="mt-2 text-sm text-slate-600">Permisos individuales con motivo y auditoría. RH autorizado puede asignar Ver y Operar; los permisos sensibles permanecen reservados a ADMIN.</p>
      </header>
      <Link href="/settings/employee-access" className="inline-flex rounded-xl bg-[#0b3a82] px-5 py-3 text-sm font-semibold text-white">Cuentas operativas y contraseñas</Link>
      <form action="/settings/cpanel-rh" className="rounded-2xl border border-slate-200 bg-white p-5">
        <label htmlFor="cpanel-user" className="block text-sm font-semibold text-[#0b3a82]">Seleccionar usuario corporativo</label>
        <div className="mt-2 flex flex-wrap gap-3">
          <select id="cpanel-user" name="userId" defaultValue={selected?.id ?? ""} className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white p-3 text-sm" required>
            <option value="">Selecciona una cuenta...</option>
            {eligible.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email ?? "Sin correo"}</option>)}
          </select>
          <button type="submit" className="rounded-xl bg-[#0b3a82] px-6 py-3 font-semibold text-white hover:bg-[#164c99]">Consultar permisos</button>
        </div>
      </form>
      {selected ? <CpanelPermissionEditor key={selected.id} userId={selected.id} userName={selected.name} /> :
        <p className="text-sm text-slate-500">Selecciona una cuenta para consultar sus permisos.</p>}
    </div>
  );
}
