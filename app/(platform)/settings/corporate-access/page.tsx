"use client";

import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Search,
  ShieldCheck,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type PermissionKey =
  | "canRequest"
  | "canRequestUrgent"
  | "canAuthorize"
  | "canViewAll"
  | "canManagePurchases";
type Permissions = Record<PermissionKey, boolean>;
type Department = { code: string; name: string };
type Employee = {
  id: string;
  employeeNumber: string;
  fullName: string;
  position: string | null;
  status: string;
  corporateUserId: string | null;
  department: Department;
};
type User = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  passwordMustChange: boolean;
  roles: string[];
  employee: {
    id: string;
    employeeNumber: string;
    fullName: string;
    position: string | null;
    status: string;
    department: Department;
  } | null;
  purchasePermissions: Permissions;
};
type ResponseBody = {
  users?: User[];
  employees?: Employee[];
  initialPassword?: string;
  error?: string;
};

const emptyPermissions: Permissions = {
  canRequest: false,
  canRequestUrgent: false,
  canAuthorize: false,
  canViewAll: false,
  canManagePurchases: false,
};

const roles = [
  "EMPLEADO",
  "RH",
  "PLANEACION",
  "PRODUCCION",
  "MANTENIMIENTO",
  "CHEF",
  "DIRECCION",
  "ADMIN",
];

const roleLabel: Record<string, string> = {
  EMPLEADO: "Operativo / Empleado",
  RH: "Recursos Humanos",
  PLANEACION: "Planeación",
  PRODUCCION: "Producción",
  MANTENIMIENTO: "Mantenimiento",
  CHEF: "Chef externo",
  DIRECCION: "Dirección",
  ADMIN: "Administrador",
};

const permissionRows: {
  key: PermissionKey;
  title: string;
  description: string;
}[] = [
  { key: "canRequest", title: "Solicitar compras", description: "Crear y consultar sus propias solicitudes." },
  { key: "canRequestUrgent", title: "Compras urgentes", description: "Registrar compras urgentes sujetas a regularización." },
  { key: "canAuthorize", title: "Autorizar compras", description: "Autorizar solicitudes de terceros; nunca las propias." },
  { key: "canViewAll", title: "Consultar todas", description: "Consultar solicitudes de otros usuarios." },
  { key: "canManagePurchases", title: "Administrar Compras", description: "Administrar permisos y operación del módulo." },
];

export default function CorporateAccessPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [userId, setUserId] = useState("");
  const [mode, setMode] = useState<"none" | "create" | "edit">("none");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EMPLEADO");
  const [active, setActive] = useState(true);
  const [permissions, setPermissions] = useState<Permissions>({ ...emptyPermissions });
  const [initialPassword, setInitialPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/corporate-access", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const data = (await response.json()) as ResponseBody;
    if (!response.ok) throw new Error(data.error ?? "Sin acceso.");
    setEmployees(data.employees ?? []);
    setUsers(data.users ?? []);
  }, []);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : "No fue posible cargar."))
      .finally(() => setLoading(false));
  }, [load]);

  const userByEmployee = useMemo(() => {
    const map = new Map<string, User>();
    users.forEach((u) => u.employee && map.set(u.employee.id, u));
    return map;
  }, [users]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((e) => {
      const u = userByEmployee.get(e.id);
      return [
        e.employeeNumber,
        e.fullName,
        e.position ?? "",
        e.department.name,
        e.department.code,
        u?.email ?? "",
      ].join(" ").toLowerCase().includes(term);
    });
  }, [employees, search, userByEmployee]);

  const selectedEmployee = employees.find((e) => e.id === employeeId) ?? null;
  const selectedUser = users.find((u) => u.id === userId) ?? null;
  const institutional = users.filter((u) => !u.employee);

  function clearMessages() {
    setError("");
    setSuccess("");
    setInitialPassword("");
  }

  function openUser(user: User) {
    clearMessages();
    setMode("edit");
    setUserId(user.id);
    setEmployeeId(user.employee?.id ?? "");
    setName(user.name);
    setEmail(user.email);
    setRole(user.roles[0] ?? "EMPLEADO");
    setActive(user.active);
    setPermissions({ ...user.purchasePermissions });
  }

  function selectEmployee(employee: Employee) {
    const user = userByEmployee.get(employee.id);
    if (user) {
      openUser(user);
      return;
    }
    clearMessages();
    setMode("create");
    setEmployeeId(employee.id);
    setUserId("");
    setName(employee.fullName);
    setEmail("");
    setRole("EMPLEADO");
    setActive(true);
    setPermissions({ ...emptyPermissions, canRequest: true });
  }

  function changePermission(key: PermissionKey, value: boolean) {
    setPermissions((current) => {
      const next = { ...current, [key]: value };
      if (key === "canRequest" && !value) next.canRequestUrgent = false;
      if (key === "canRequestUrgent" && value) next.canRequest = true;
      return next;
    });
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!selectedEmployee) return;
    setBusy(true);
    clearMessages();
    try {
      const response = await fetch("/api/admin/corporate-access", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          employeeId: selectedEmployee.id,
          role,
          purchasePermissions: permissions,
        }),
      });
      const data = (await response.json()) as ResponseBody;
      if (!response.ok) throw new Error(data.error ?? "No se pudo crear la cuenta.");
      setInitialPassword(data.initialPassword ?? "");
      setSuccess("Cuenta creada, vinculada y con permisos aplicados.");
      await load();
      setMode("none");
      setEmployeeId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No fue posible crear la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selectedUser) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/admin/corporate-access", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUser.id,
          name,
          email,
          role,
          active,
          purchasePermissions: permissions,
        }),
      });
      const data = (await response.json()) as ResponseBody;
      if (!response.ok) throw new Error(data.error ?? "No se pudieron guardar los cambios.");
      setSuccess("Usuario y permisos actualizados correctamente.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No fue posible guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 pb-10">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-amber-700">
              <ShieldCheck className="size-4" /> Administración corporativa
            </p>
            <h1 className="mt-2 text-3xl font-bold text-[#0b3a82]">Usuarios y accesos</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Busca colaboradores de RH, crea su acceso y modifica posteriormente
              su perfil, estado y permisos sin alterar su expediente laboral.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Colaboradores" value={employees.length} />
            <Stat label="Con acceso" value={users.filter((u) => u.employee).length} />
            <Stat label="Sin acceso" value={employees.filter((e) => !userByEmployee.has(e.id)).length} />
          </div>
        </div>
      </header>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {success && <div className="flex gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><CheckCircle2 className="size-5" />{success}</div>}

      {initialPassword && (
        <section className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-6">
          <div className="flex gap-3">
            <KeyRound className="size-5 text-amber-800" />
            <div>
              <h2 className="font-bold">Contraseña inicial — visible una sola vez</h2>
              <p className="mt-2 break-all font-mono text-lg font-bold">{initialPassword}</p>
              <p className="mt-2 text-sm">Entrégala al titular por un canal seguro. Deberá cambiarla al iniciar sesión.</p>
              <button type="button" onClick={() => navigator.clipboard.writeText(initialPassword)} className="mt-3 rounded-xl bg-[#0b3a82] px-4 py-2 text-sm font-bold text-white">Copiar contraseña</button>
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="flex items-center gap-2 font-bold text-blue-950"><Users className="size-5" /> Buscar colaborador</h2>
            <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, número, puesto, departamento o correo..." className="w-full rounded-xl border py-3 pl-10 pr-4 text-sm outline-none focus:border-[#0b3a82]" />
            </div>
          </div>
          <div className="max-h-[620px] overflow-y-auto divide-y">
            {loading ? (
              <div className="flex justify-center gap-2 p-10 text-sm text-slate-500"><Loader2 className="size-5 animate-spin" />Cargando...</div>
            ) : filtered.map((employee) => {
              const user = userByEmployee.get(employee.id);
              return (
                <button key={employee.id} type="button" onClick={() => selectEmployee(employee)} className={`w-full p-4 text-left hover:bg-slate-50 ${employee.id === employeeId ? "bg-blue-50" : ""}`}>
                  <div className="flex justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold">{employee.fullName}</p>
                      <p className="mt-1 text-xs text-slate-500">#{employee.employeeNumber} · {employee.position || "Puesto no registrado"} · {employee.department.name}</p>
                    </div>
                    <span className={`h-fit rounded-full px-2.5 py-1 text-[10px] font-bold ${user ? (user.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500") : "bg-amber-50 text-amber-700"}`}>
                      {user ? (user.active ? "CON ACCESO" : "INACTIVO") : "SIN ACCESO"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          {institutional.length > 0 && (
            <div className="border-t bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase text-slate-500">Cuentas institucionales / externas</p>
              {institutional.map((u) => (
                <button key={u.id} type="button" onClick={() => openUser(u)} className="mt-2 w-full rounded-xl bg-white p-3 text-left ring-1 ring-slate-200">
                  <strong className="text-sm">{u.name}</strong>
                  <span className="ml-2 text-xs text-slate-500">{u.email}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          {mode === "none" ? (
            <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
              <UserCog className="size-10 text-[#0b3a82]" />
              <h2 className="mt-4 text-xl font-bold text-blue-950">Selecciona una persona</h2>
              <p className="mt-2 text-sm text-slate-500">Crea un acceso nuevo o modifica uno existente.</p>
            </div>
          ) : (
            <form onSubmit={mode === "create" ? create : save} className="space-y-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-amber-700">{mode === "create" ? "Crear acceso" : "Editar acceso"}</p>
                <h2 className="mt-1 text-xl font-bold text-blue-950">
                  {mode === "create" ? selectedEmployee?.fullName : selectedUser?.employee?.fullName ?? selectedUser?.name}
                </h2>
                {(selectedEmployee || selectedUser?.employee) && (
                  <p className="mt-1 text-sm text-slate-500">
                    #{(selectedEmployee ?? selectedUser?.employee)?.employeeNumber} · {(selectedEmployee ?? selectedUser?.employee)?.position || "Puesto no registrado"} · {(selectedEmployee ?? selectedUser?.employee)?.department.name}
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950">
                Puesto y departamento pertenecen a RH. Aquí modificas el acceso digital a Platform.
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre de cuenta"><input required minLength={3} value={name} onChange={(e) => setName(e.target.value)} className="mt-2 w-full rounded-xl border p-3 font-normal" /></Field>
                <Field label="Correo electrónico"><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 w-full rounded-xl border p-3 font-normal" /></Field>
                <Field label="Perfil de acceso">
                  <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-2 w-full rounded-xl border bg-white p-3 font-normal">
                    {roles.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                  </select>
                </Field>
                <div className="rounded-xl border p-3">
                  <p className="text-sm font-semibold">Estado de cuenta</p>
                  <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={active} disabled={mode === "create"} onChange={(e) => setActive(e.target.checked)} />{active ? "Activa" : "Desactivada"}</label>
                </div>
              </div>

              <div>
                <h3 className="font-bold text-blue-950">Permisos de Compras</h3>
                <div className="mt-3 space-y-2">
                  {permissionRows.map((p) => (
                    <label key={p.key} className="flex gap-3 rounded-xl border p-3">
                      <input type="checkbox" checked={permissions[p.key]} onChange={(e) => changePermission(p.key, e.target.checked)} className="mt-1 size-4 accent-[#0b3a82]" />
                      <span><strong className="block text-sm">{p.title}</strong><span className="text-xs text-slate-500">{p.description}</span></span>
                    </label>
                  ))}
                </div>
              </div>

              <button disabled={busy} className="flex w-full justify-center gap-2 rounded-xl bg-[#0b3a82] p-3.5 text-sm font-bold text-white disabled:opacity-50">
                {busy ? <Loader2 className="size-5 animate-spin" /> : mode === "create" ? <UserPlus className="size-5" /> : <CheckCircle2 className="size-5" />}
                {busy ? "Guardando..." : mode === "create" ? "Crear acceso a Platform" : "Guardar cambios"}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-blue-950">{value}</p></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-sm font-semibold text-slate-700">{label}{children}</label>;
}
