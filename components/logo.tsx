import Link from "next/link";

export default function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/dashboard" className="group flex items-center gap-3" aria-label="Ir al inicio de YellowFlex">
      <span className="flex size-10 items-center justify-center rounded-xl bg-[#f4b400] text-sm font-black tracking-tighter text-[#0b3a82] shadow-sm transition-transform group-hover:scale-105">YF</span>
      {!compact && <span><span className="block text-base font-extrabold tracking-tight text-white">YELLOWFLEX</span><span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-blue-200">Platform</span></span>}
    </Link>
  );
}
