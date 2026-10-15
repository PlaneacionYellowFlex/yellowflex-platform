"use client";

import { Bell, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import Breadcrumb from "@/components/breadcrumb";
import UserMenu from "@/components/user-menu";
import type { AuthenticatedUser } from "@/lib/access-control";

type TopbarProps = {
  user: AuthenticatedUser;
};

type SearchEntry = {
  label: string;
  description: string;
  href?: string;
  keywords: string;
  comingSoon?: boolean;
};

const SEARCH_ENTRIES: SearchEntry[] = [
  { label: "Inicio", description: "Página principal de Platform", href: "/dashboard", keywords: "inicio dashboard principal home" },
  { label: "Food Services", description: "Comedor y servicios alimentarios", href: "/modules/food-services", keywords: "food services comedor alimentos comida chef" },
  { label: "Mi menú", description: "Portal de alimentos del colaborador", href: "/modules/food-services/employee", keywords: "menu comida empleado reservacion alimentos" },
  { label: "Gestión de menú", description: "Administración del menú del Chef", href: "/modules/food-services/chef", keywords: "chef menu alimentos food services" },
  { label: "Administración Food Services", description: "Administración de Food Services para RH", href: "/modules/food-services/hr", keywords: "rh food services administracion comedor" },
  { label: "Registro de consumo", description: "Operación de consumo de alimentos", href: "/modules/food-services/consumption", keywords: "consumo comida comedor registro" },
  { label: "Mi RH", description: "Vacaciones, permisos e incidencias personales", href: "/modules/my-rh", keywords: "mi rh vacaciones permisos faltas ausencia salir temprano retardo incapacidad" },
  { label: "Recursos Humanos", description: "Personas y organización", href: "/modules/rrhh", keywords: "rh recursos humanos empleados colaboradores personal" },
  { label: "Solicitudes e incidencias RH", description: "Bandeja de autorización de Recursos Humanos", href: "/modules/rrhh/requests", keywords: "rh solicitudes incidencias vacaciones permisos autorizacion faltas retardos" },
  { label: "Control Tower", description: "Inteligencia operativa", href: "/modules/control-tower", keywords: "control tower oee produccion maquinas indicadores" },
  { label: "Compras", description: "Solicitudes y seguimiento de compras", href: "/modules/purchases", keywords: "compras compra solicitudes requisiciones autorizaciones proveedores" },
  { label: "Administración de Compras", description: "Permisos del módulo de Compras", href: "/modules/purchases/admin", keywords: "compras permisos administrador autorizadores accesos" },
  { label: "Mantenimiento", description: "Gestión de activos", href: "/modules/mantenimiento", keywords: "mantenimiento activos maquinas preventivo correctivo" },
  { label: "Almacén", description: "Inventarios y movimientos", href: "/modules/warehouse", keywords: "almacen inventario movimientos materiales ubicaciones existencias" },
  { label: "Calidad", description: "Calidad y Producto No Conforme", keywords: "calidad producto no conforme pnc inspeccion", comingSoon: true },
  { label: "Mejora Continua", description: "Proyectos e iniciativas de mejora", keywords: "mejora continua proyectos iniciativas", comingSoon: true },
  { label: "Vigilancia", description: "Seguridad y control de accesos", keywords: "vigilancia seguridad accesos", comingSoon: true },
  { label: "Configuración", description: "Preferencias y administración de Platform", href: "/settings", keywords: "configuracion settings administracion plataforma" },
  { label: "Usuarios y accesos", description: "Alta, edición y permisos de usuarios corporativos", href: "/settings/corporate-access", keywords: "usuarios accesos administrador alta usuario permisos cuentas empleados contraseña roles corporate access" },
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export default function Topbar({ user }: TopbarProps) {
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const normalized = normalize(query);
    if (!normalized) return [];

    return SEARCH_ENTRIES.filter((entry) =>
      normalize(`${entry.label} ${entry.description} ${entry.keywords}`).includes(normalized),
    ).slice(0, 8);
  }, [query]);

  useEffect(() => {
    function handleOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  function go(entry: SearchEntry) {
    if (!entry.href || entry.comingSoon) return;
    setQuery("");
    setOpen(false);
    router.push(entry.href);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:h-20 lg:px-10">
        <div className="ml-12 min-w-0 lg:ml-0">
          <Breadcrumb />
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div ref={wrapperRef} className="relative hidden lg:block">
            <label className="flex w-72 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-500 transition focus-within:border-[#0b3a82]/40 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-50">
              <Search className="size-4 shrink-0" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && results[0]?.href && !results[0].comingSoon) {
                    go(results[0]);
                  }
                  if (event.key === "Escape") setOpen(false);
                }}
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                placeholder="Buscar módulos, usuarios, accesos..."
                aria-label="Buscar en YellowFlex Platform"
              />
            </label>

            {open && query.trim() && (
              <div className="absolute right-0 top-[calc(100%+8px)] w-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
                {results.length > 0 ? (
                  <div className="p-2">
                    {results.map((entry) => (
                      <button
                        key={entry.label}
                        type="button"
                        disabled={!entry.href || entry.comingSoon}
                        onClick={() => go(entry)}
                        className={`flex w-full items-center justify-between gap-4 rounded-xl px-3 py-3 text-left transition ${
                          entry.comingSoon
                            ? "cursor-default text-slate-400"
                            : "text-slate-700 hover:bg-blue-50"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{entry.label}</span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500">{entry.description}</span>
                        </span>
                        {entry.comingSoon && (
                          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-amber-700">
                            Próximamente
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-5 text-sm text-slate-500">
                    No encontramos una pantalla con ese término.
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            disabled
            aria-label="Notificaciones próximamente disponibles"
            className="relative flex size-9 items-center justify-center rounded-xl text-slate-400"
          >
            <Bell className="size-[18px]" />
            <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[#f4b400]" />
          </button>

          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
