"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

type PermissionKey =
  | "canRequest"
  | "canRequestUrgent"
  | "canAuthorize"
  | "canViewAll"
  | "canManagePurchases";

type Permissions = Record<PermissionKey, boolean>;

type CorporateUser = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  roles: string[];
  permissions: Permissions;
};

type UsersResponse = { users?: CorporateUser[]; error?: string };
type SaveResponse = {
  userId?: string;
  permissions?: Permissions;
  error?: string;
};

const permissionLabels: {
  key: PermissionKey;
  title: string;
  description: string;
}[] = [
  {
    key: "canRequest",
    title: "Solicitar compras",
    description: "Puede registrar y consultar sus propias solicitudes.",
  },
  {
    key: "canRequestUrgent",
    title: "Compras urgentes",
    description:
      "Puede registrar compras urgentes sujetas a regularización posterior.",
  },
  {
    key: "canAuthorize",
    title: "Autorizar compras",
    description:
      "Puede autorizar solicitudes de otros usuarios; nunca puede autorizar compras propias.",
  },
  {
    key: "canViewAll",
    title: "Consultar todas las solicitudes",
    description: "Puede consultar las solicitudes de otros usuarios.",
  },
  {
    key: "canManagePurchases",
    title: "Administrar Compras",
    description:
      "Puede gestionar permisos del módulo; la autorización se concede por separado.",
  },
];

function samePermissions(a: Permissions, b: Permissions): boolean {
  return permissionLabels.every(({ key }) => a[key] === b[key]);
}

export default function PurchasePermissionsAdminPage() {
  const [users, setUsers] = useState<CorporateUser[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Permissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selected =
    users.find((user) => user.id === selectedId) ?? null;
  const changed =
    !!selected &&
    !!draft &&
    !samePermissions(selected.permissions, draft);

  const loadUsers = useCallback(async (preferredId?: string) => {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/purchases/admin/permissions", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });

      const body: UsersResponse = await response.json();

      if (!response.ok || !Array.isArray(body.users)) {
        throw new Error(
          body.error || "No fue posible consultar los permisos.",
        );
      }

      setUsers(body.users);
      setSelectedId((current) => {
        const candidate = preferredId ?? current;
        return body.users!.some((user) => user.id === candidate)
          ? candidate
          : "";
      });
      setDraft(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No fue posible consultar los permisos.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  function selectUser(id: string) {
    if (saving || loading) return;

    if (
      changed &&
      !window.confirm("Hay cambios sin guardar. ¿Deseas descartarlos?")
    ) {
      return;
    }

    const user = users.find((item) => item.id === id);
    setSelectedId(id);
    setDraft(user ? { ...user.permissions } : null);
    setError("");
    setNotice("");
  }

  function changePermission(key: PermissionKey, checked: boolean) {
    if (!draft || !selected || saving) return;

    setNotice("");
    setError("");

    setDraft((current) => {
      if (!current) return current;

      const next = { ...current, [key]: checked };

      if (key === "canRequest" && !checked) {
        next.canRequestUrgent = false;
      }

      return next;
    });
  }

  async function savePermissions() {
    if (!selected || !draft || !changed || saving) return;

    setError("");
    setNotice("");
    setSaving(true);

    try {
      const response = await fetch("/api/purchases/admin/permissions", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selected.id,
          ...draft,
        }),
      });

      const body: SaveResponse = await response.json();

      if (
        !response.ok ||
        !body.permissions ||
        body.userId !== selected.id
      ) {
        throw new Error(
          body.error || "No fue posible guardar los permisos.",
        );
      }

      const saved = body.permissions;

      setUsers((current) =>
        current.map((user) =>
          user.id === selected.id
            ? { ...user, permissions: saved }
            : user,
        ),
      );

      setDraft({ ...saved });
      setNotice("Permisos guardados correctamente.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No fue posible guardar los permisos.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 text-slate-800 sm:px-6 lg:px-8">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-amber-700">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          YellowFlex · Compras
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-blue-950 sm:text-3xl">
          Administración de permisos
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Asigna permisos individuales a las cuentas corporativas existentes.
          Los permisos de Compras son independientes del rol corporativo general.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {notice}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.85fr)_minmax(0,1.15fr)]">
        <section
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          aria-label="Usuarios corporativos"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="font-semibold text-blue-950">
                Usuarios corporativos
              </h2>
              <p className="text-xs text-slate-500">
                {users.length} cuentas
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                if (
                  changed &&
                  !window.confirm(
                    "Hay cambios sin guardar. ¿Deseas descartarlos?",
                  )
                ) {
                  return;
                }
                void loadUsers(selectedId);
              }}
              disabled={loading || saving}
              className="rounded-lg border border-slate-200 p-2 text-blue-900 hover:bg-slate-50 disabled:opacity-50"
              aria-label="Actualizar usuarios"
              title="Actualizar usuarios"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 p-5 text-sm text-slate-600">
              <Loader2
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
              Cargando usuarios…
            </div>
          ) : users.length === 0 ? (
            <p className="p-5 text-sm text-slate-600">
              No hay usuarios disponibles.
            </p>
          ) : (
            <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
              {users.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => selectUser(user.id)}
                  disabled={saving}
                  aria-pressed={selectedId === user.id}
                  className={`w-full px-5 py-4 text-left transition-colors hover:bg-blue-50 disabled:opacity-60 ${
                    selectedId === user.id
                      ? "bg-blue-50 ring-1 ring-inset ring-blue-200"
                      : ""
                  }`}
                >
                  <span className="block break-words text-sm font-semibold text-blue-950">
                    {user.name}
                  </span>
                  <span className="mt-1 block break-all text-xs text-slate-500">
                    {user.email}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    {user.roles.map((role) => (
                      <span
                        key={role}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                      >
                        {role}
                      </span>
                    ))}
                    {!user.active && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                        Inactivo
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
          aria-label="Permisos del usuario seleccionado"
        >
          {!selected || !draft ? (
            <div className="flex min-h-64 items-center justify-center text-center text-sm text-slate-500">
              Selecciona un usuario para consultar o modificar sus permisos.
            </div>
          ) : (
            <>
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-lg font-semibold text-blue-950">
                  {selected.name}
                </h2>
                <p className="break-all text-sm text-slate-500">
                  {selected.email}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Los cambios se guardan únicamente al presionar «Guardar
                  permisos».
                </p>
              </div>

              <div className="divide-y divide-slate-100">
                {permissionLabels.map(({ key, title, description }) => {
                  const unavailable =
                    !selected.active ||
                    (key === "canRequestUrgent" && !draft.canRequest);

                  return (
                    <label
                      key={key}
                      className={`flex items-start justify-between gap-4 py-5 ${
                        unavailable ? "opacity-60" : "cursor-pointer"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-800">
                          {title}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">
                          {description}
                        </span>
                      </span>

                      <input
                        type="checkbox"
                        className="mt-1 h-5 w-5 shrink-0 accent-blue-900"
                        checked={draft[key]}
                        onChange={(event) =>
                          changePermission(key, event.target.checked)
                        }
                        disabled={saving || unavailable}
                      />
                    </label>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
                <span className="text-xs text-slate-500">
                  {changed
                    ? "Tienes cambios sin guardar."
                    : "Sin cambios pendientes."}
                </span>

                <button
                  type="button"
                  onClick={() => void savePermissions()}
                  disabled={!changed || saving || !selected.active}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-blue-900 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving && (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {saving ? "Guardando…" : "Guardar permisos"}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
