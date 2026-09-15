"use client";

import { ChevronRight, Home } from "lucide-react";
import { usePathname } from "next/navigation";
import { getPageContext } from "@/lib/navigation";

export default function Breadcrumb() {
  const context = getPageContext(usePathname());
  return <div className="flex min-w-0 items-center gap-1.5 text-sm"><Home className="size-3.5 shrink-0 text-slate-400" /><ChevronRight className="size-3.5 shrink-0 text-slate-300" /><span className="truncate font-medium text-slate-500">{context.section}</span>{context.title !== context.section && <><ChevronRight className="size-3.5 shrink-0 text-slate-300" /><span className="truncate font-semibold text-[#0b3a82]">{context.title}</span></>}</div>;
}
