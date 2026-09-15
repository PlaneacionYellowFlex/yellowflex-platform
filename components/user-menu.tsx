"use client";

import {
  ChevronDown,
  LoaderCircle,
  LogOut,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AuthenticatedUser } from "@/lib/access-control";

type UserMenuProps = {
  user: AuthenticatedUser;
};

const roleLabels: Record<string, string> = {
  ADMIN: "Administrador",
  DIRECCION: "Dirección",
  RH: "Recursos Humanos",
  CHEF: "Chef",
  PLANEACION: "Planeación",
  PRODUCCION: "Producción",
  MANTENIMIENTO: "Mantenimiento",
  EMPLEADO: "Colaborador",
};

function getInitials(name: string) {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "YF";
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function getRoleLabel(roles: string[]) {
  if (roles.includes("ADMIN")) {
    return roleLabels.ADMIN;
  }

  return roles
    .map((role) => roleLabels[role] ?? role)
    .join(" · ");
}

export default function UserMenu({
  user,
}: UserMenuProps) {
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] =
    useState(false);

  const initials = getInitials(user.name);
  const roleLabel = getRoleLabel(user.roles);

  async function logout() {
    if (isLoggingOut) {
      return;
    }

    try {
      setIsLoggingOut(true);

      const response = await fetch("/api/auth/logout", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(
          "No fue posible cerrar la sesión.",
        );
      }

      router.replace("/login");
      router.refresh();
    } catch {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex items-center gap-2 rounded-xl p-1.5 text-left transition hover:bg-slate-50"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <span className="flex size-9 items-center justify-center rounded-xl bg-[#0b3a82] text-xs font-black text-white shadow-sm">
          {initials}
        </span>

        <span className="hidden max-w-44 leading-tight md:block">
          <span className="block truncate text-sm font-semibold text-slate-800">
            {user.name}
          </span>

          <span className="block truncate text-xs text-slate-500">
            {roleLabel}
          </span>
        </span>

        <ChevronDown className="hidden size-4 text-slate-400 md:block" />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
        >
          <div className="border-b border-slate-100 p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50">
                <UserRound className="size-5 text-[#0b3a82]" />
              </span>

              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">
                  {user.name}
                </p>

                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {user.email}
                </p>

                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-[#0b3a82]">
                  <ShieldCheck className="size-3" />
                  {roleLabel}
                </div>
              </div>
            </div>
          </div>

          <div className="p-2">
            <button
              type="button"
              role="menuitem"
              onClick={logout}
              disabled={isLoggingOut}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-600 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoggingOut ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <LogOut className="size-4" />
              )}

              {isLoggingOut
                ? "Cerrando sesión..."
                : "Cerrar sesión"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}