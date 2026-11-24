"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Plus,
  RefreshCw,
  ShoppingCart,
  X,
} from "lucide-react";

type PermissionKey =
  | "canRequest"
  | "canRequestUrgent"
  | "canAuthorize"
  | "canViewAll"
  | "canManagePurchases";

type Permissions = Record<PermissionKey, boolean>;

type Item = {
  id?: string;
  description: string;
  quantity: string | number;
  unit: string;
  position?: number;
};

type PurchaseRequest = {
  id: string;
  folio: string;
  requesterId: string;
  requesterDepartment: string | null;
  description: string;
  justification: string;
  requiredDate: string | null;
  isUrgent: boolean;
  authorizationStatus: string;
  documentStatus: string;
  createdAt: string;
  requester: { id: string; name: string; email: string };
  items: Item[];
};

const EMPTY_ITEM: Item = {
  description: "",
  quantity: 1,
  unit: "PZA",
};

const statusText: Record<string, string> = {
  PENDING: "Pendiente de autorización",
  INFORMATION_REQUIRED: "Información requerida",
  AUTHORIZED: "Autorizada",
  REJECTED: "Rechazada",
  REGULARIZATION_PENDING: "Regularización pendiente",
  REGULARIZED: "Regularizada",
  REGULARIZATION_REJECTED: "Regularización rechazada",
};

function dateLabel(value: string | null) {
  if (!value) return "Sin fecha requerida";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default function PurchasesPage() {
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [items, setItems] = useState<Item[]>([{ ...EMPTY_ITEM }]);
  const [justification, setJustification] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [urgencyReason, setUrgencyReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [permissionResponse, requestsResponse] = await Promise.all([
        fetch("/api/purchases/permissions", {
          credentials: "same-origin",
          cache: "no-store",
        }),
        fetch("/api/purchases/requests", {
          credentials: "same-origin",
          cache: "no-store",
        }),
      ]);

      const permissionBody = await permissionResponse.json();
      const requestsBody = await requestsResponse.json();

      if (!permissionResponse.ok) {
        throw new Error(
          permissionBody.error || "No fue posible consultar tus permisos.",
        );
      }

      setPermissions(permissionBody.permissions);

      if (requestsResponse.ok) {
        setRequests(requestsBody.requests ?? []);
      } else if (
        permissionBody.permissions?.canRequest ||
        permissionBody.permissions?.canViewAll
      ) {
        throw new Error(
          requestsBody.error || "No fue posible consultar las solicitudes.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No fue posible cargar Compras.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = useMemo(
    () =>
      requests.filter((request) =>
        ["PENDING", "REGULARIZATION_PENDING"].includes(
          request.authorizationStatus,
        ),
      ).length,
    [requests],
  );

  function updateItem(index: number, key: keyof Item, value: string) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    );
  }

  function resetForm() {
    setItems([{ ...EMPTY_ITEM }]);
    setJustification("");
    setRequiredDate("");
    setIsUrgent(false);
    setUrgencyReason("");
  }

  async function createRequest() {
    setError("");
    setNotice("");

    const cleanItems = items.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unit: item.unit.trim(),
    }));

    if (
      cleanItems.some(
        (item) =>
          item.description.length < 2 ||
          !Number.isFinite(item.quantity) ||
          item.quantity <= 0 ||
          !item.unit,
      )
    ) {
      setError("Completa correctamente todas las partidas.");
      return;
    }

    if (justification.trim().length < 5) {
      setError("Indica la justificación de la compra.");
      return;
    }

    if (isUrgent && !urgencyReason.trim()) {
      setError("Indica por qué la compra es urgente.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/purchases/requests", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cleanItems,
          justification: justification.trim(),
          requiredDate: requiredDate || null,
          isUrgent,
          urgencyReason: isUrgent ? urgencyReason.trim() : null,
        }),
      });

      const body = await response.json();

      if (!response.ok || !body.request) {
        throw new Error(body.error || "No fue posible crear la solicitud.");
      }

      setNotice(`Solicitud ${body.request.folio} creada correctamente.`);
      setShowForm(false);
      resetForm();
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No fue posible crear la solicitud.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-[55vh] items-center justify-center text-slate-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Cargando Compras…
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 text-slate-800 sm:px-6 lg:px-8">
      <header className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-6 sm:px-8">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-700">
            <ShoppingCart className="h-4 w-4" />
            YellowFlex · Compras
          </div>
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-blue-950">
                Solicitudes de compra
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Solicitud, autorización y trazabilidad operativa en un solo
                folio.
              </p>
            </div>

            {permissions?.canRequest && (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-900"
              >
                <Plus className="h-4 w-4" />
                Nueva solicitud
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-px bg-slate-200 sm:grid-cols-3">
          <div className="bg-white px-6 py-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Solicitudes visibles
            </p>
            <p className="mt-1 text-2xl font-bold text-blue-950">
              {requests.length}
            </p>
          </div>
          <div className="bg-white px-6 py-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Pendientes
            </p>
            <p className="mt-1 text-2xl font-bold text-blue-950">
              {pendingCount}
            </p>
          </div>
          <div className="bg-white px-6 py-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Alcance
            </p>
            <p className="mt-1 text-sm font-semibold text-blue-950">
              {permissions?.canViewAll
                ? "Todas las solicitudes"
                : "Mis solicitudes"}
            </p>
          </div>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {notice}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-blue-950">
              {permissions?.canViewAll
                ? "Bandeja de solicitudes"
                : "Mis solicitudes"}
            </h2>
            <p className="text-xs text-slate-500">
              Ordenadas desde la más reciente.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-slate-200 p-2 text-blue-950 hover:bg-slate-50"
            title="Actualizar"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {requests.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <ClipboardList className="mx-auto h-9 w-9 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">
              Aún no hay solicitudes.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {requests.map((request) => (
              <a
                key={request.id}
                href={`/modules/purchases/${request.id}`}
                className="flex flex-col gap-3 px-5 py-5 transition-colors hover:bg-slate-50 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-blue-950">
                      {request.folio}
                    </span>
                    {request.isUrgent && (
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">
                        URGENTE
                      </span>
                    )}
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                      {statusText[request.authorizationStatus] ??
                        request.authorizationStatus}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm font-medium text-slate-800">
                    {request.items.length === 1
                      ? request.items[0].description
                      : `${request.items.length} partidas`}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {request.requester.name}
                    {request.requesterDepartment
                      ? ` · ${request.requesterDepartment}`
                      : ""}
                    {" · "}
                    {dateLabel(request.requiredDate)}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
              </a>
            ))}
          </div>
        )}
      </section>

      {showForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/35 p-4 backdrop-blur-sm">
          <div className="mx-auto my-6 max-w-4xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2 className="text-xl font-bold text-blue-950">
                  Nueva solicitud de compra
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Puedes incluir varias partidas bajo el mismo folio.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6 px-6 py-6">
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-blue-950">
                    Partidas
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      setItems((current) => [
                        ...current,
                        { ...EMPTY_ITEM },
                      ])
                    }
                    className="text-sm font-semibold text-blue-900 hover:underline"
                  >
                    + Agregar partida
                  </button>
                </div>

                <div className="space-y-3">
                  {items.map((item, index) => (
                    <div
                      key={index}
                      className="grid gap-3 rounded-2xl border border-slate-200 p-4 md:grid-cols-[1fr_130px_130px_auto]"
                    >
                      <input
                        value={item.description}
                        onChange={(event) =>
                          updateItem(
                            index,
                            "description",
                            event.target.value,
                          )
                        }
                        placeholder="Descripción del material o servicio"
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-800"
                      />
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={item.quantity}
                        onChange={(event) =>
                          updateItem(
                            index,
                            "quantity",
                            event.target.value,
                          )
                        }
                        placeholder="Cantidad"
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-800"
                      />
                      <input
                        value={item.unit}
                        onChange={(event) =>
                          updateItem(index, "unit", event.target.value)
                        }
                        placeholder="Unidad"
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm uppercase outline-none focus:border-blue-800"
                      />
                      <button
                        type="button"
                        disabled={items.length === 1}
                        onClick={() =>
                          setItems((current) =>
                            current.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          )
                        }
                        className="rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Justificación
                </label>
                <textarea
                  value={justification}
                  onChange={(event) =>
                    setJustification(event.target.value)
                  }
                  rows={3}
                  placeholder="¿Por qué se requiere esta compra?"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-800"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Fecha requerida
                  </label>
                  <input
                    type="date"
                    value={requiredDate}
                    onChange={(event) =>
                      setRequiredDate(event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-800"
                  />
                </div>

                {permissions?.canRequestUrgent && (
                  <label className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isUrgent}
                      onChange={(event) =>
                        setIsUrgent(event.target.checked)
                      }
                      className="h-5 w-5 accent-amber-700"
                    />
                    <span>
                      <span className="block text-sm font-bold text-amber-900">
                        Compra urgente
                      </span>
                      <span className="text-xs text-amber-800">
                        Se regularizará posteriormente.
                      </span>
                    </span>
                  </label>
                )}
              </div>

              {isUrgent && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <label className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-900">
                    <AlertTriangle className="h-4 w-4" />
                    Motivo de urgencia
                  </label>
                  <textarea
                    value={urgencyReason}
                    onChange={(event) =>
                      setUrgencyReason(event.target.value)
                    }
                    rows={3}
                    className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-700"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-5">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void createRequest()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Crear solicitud
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
