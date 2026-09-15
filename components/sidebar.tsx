"use client";

import {
  ChevronRight,
  LockKeyhole,
  Menu,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import Logo from "@/components/logo";
import {
  futureNavigation,
  primaryNavigation,
  secondaryNavigation,
  type NavigationItem,
} from "@/lib/navigation";

function ActiveNavigation({
  items,
  close,
}: {
  items: NavigationItem[];
  close?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-1">
      {items.map(({ href, icon: Icon, label }) => {
        if (!href) {
          return null;
        }

        const isActive =
          pathname === href ||
          (href !== "/dashboard" &&
            pathname.startsWith(`${href}/`));

        return (
          <Link
            key={href}
            href={href}
            onClick={close}
            className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
              isActive
                ? "bg-white text-[#0b3a82] shadow-sm"
                : "text-blue-100 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-lg transition ${
                isActive
                  ? "bg-blue-50"
                  : "bg-white/5 group-hover:bg-white/10"
              }`}
            >
              <Icon
                className="size-[17px]"
                strokeWidth={isActive ? 2.4 : 2}
              />
            </span>

            <span className="min-w-0 flex-1 truncate">
              {label}
            </span>

            {isActive && (
              <ChevronRight className="size-4 text-[#f4b400]" />
            )}
          </Link>
        );
      })}
    </div>
  );
}

function FutureNavigation() {
  return (
    <div className="space-y-1">
      {futureNavigation.map(({ icon: Icon, label }) => (
        <div
          key={label}
          className="group flex cursor-default items-center gap-3 rounded-xl px-3 py-2 text-blue-100/65"
          title={`${label} · Próximamente`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-white/[0.04]">
            <Icon className="size-4" strokeWidth={1.8} />
          </span>

          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {label}
          </span>

          <span className="rounded-full border border-[#f4b400]/25 bg-[#f4b400]/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-[#f4b400]">
            Próximamente
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);

  const close = () => setIsOpen(false);

  return (
    <>
      <button
        type="button"
        className="fixed left-4 top-4 z-40 flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-[#0b3a82] shadow-sm lg:hidden"
        onClick={() => setIsOpen(true)}
        aria-label="Abrir navegación"
      >
        <Menu className="size-5" />
      </button>

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-[#0b3a82] shadow-2xl shadow-blue-950/20 transition-transform lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="border-b border-white/10 px-5 pb-5 pt-5">
          <div className="flex items-center justify-between">
            <Logo />

            <button
              type="button"
              className="rounded-lg p-2 text-blue-100 hover:bg-white/10 lg:hidden"
              onClick={close}
              aria-label="Cerrar navegación"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-50" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-300" />
            </span>

            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-100">
              YellowFlex Platform
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <p className="mb-2 px-3 text-[9px] font-black uppercase tracking-[0.22em] text-blue-300">
            Operación activa
          </p>

          <ActiveNavigation
            items={primaryNavigation}
            close={close}
          />

          <div className="my-5 border-t border-white/10" />

          <div className="mb-3 flex items-center justify-between px-3">
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-blue-300">
              Ecosistema YellowFlex
            </p>

            <span className="text-[9px] font-bold text-[#f4b400]">
              ROADMAP
            </span>
          </div>

          <FutureNavigation />

          <div className="my-5 border-t border-white/10" />

          <ActiveNavigation
            items={secondaryNavigation}
            close={close}
          />
        </div>

        <div className="border-t border-white/10 p-5">
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-[#f4b400]/15 text-[#f4b400]">
                <LockKeyhole className="size-4" />
              </span>

              <div>
                <p className="text-xs font-bold text-white">
                  Acceso corporativo
                </p>
                <p className="mt-0.5 text-[10px] text-blue-200">
                  Sesión protegida por roles
                </p>
              </div>
            </div>
          </div>

          <p className="mt-4 text-center text-[9px] font-medium uppercase tracking-[0.16em] text-blue-300/70">
            YellowFlex Digital Operations
          </p>
        </div>
      </aside>

      {isOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-950/30 lg:hidden"
          onClick={close}
          aria-label="Cerrar navegación"
        />
      )}
    </>
  );
}