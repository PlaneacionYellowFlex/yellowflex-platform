"use client";

import { Bell, Search } from "lucide-react";

import Breadcrumb from "@/components/breadcrumb";
import UserMenu from "@/components/user-menu";
import type { AuthenticatedUser } from "@/lib/access-control";

type TopbarProps = {
  user: AuthenticatedUser;
};

export default function Topbar({
  user,
}: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:h-20 lg:px-10">
        <div className="ml-12 min-w-0 lg:ml-0">
          <Breadcrumb />
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <label className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-400 lg:flex">
            <Search className="size-4" />

            <input
              className="w-36 bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Buscar próximamente"
              disabled
              aria-label="Búsqueda próximamente disponible"
            />
          </label>

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