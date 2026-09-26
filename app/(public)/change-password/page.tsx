"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirm) { setError("Las contraseñas nuevas no coinciden."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo actualizar la contraseña.");
      router.replace("/dashboard"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error inesperado."); }
    finally { setBusy(false); }
  }
  return <main className="flex min-h-screen items-center justify-center bg-[#f7f9fc] p-5"><form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><div className="h-1 w-20 rounded bg-[#f4b400]"/><h1 className="text-2xl font-bold text-[#0b3a82]">Establecer contraseña</h1><p className="text-sm text-slate-600">Por seguridad, cambia tu contraseña inicial antes de continuar. Mínimo 14 caracteres.</p><label className="block text-sm font-semibold">Contraseña actual<input type="password" autoComplete="current-password" required value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} className="mt-2 w-full rounded-xl border p-3"/></label><label className="block text-sm font-semibold">Nueva contraseña<input type="password" autoComplete="new-password" required minLength={14} value={newPassword} onChange={e=>setNewPassword(e.target.value)} className="mt-2 w-full rounded-xl border p-3"/></label><label className="block text-sm font-semibold">Confirmar nueva contraseña<input type="password" autoComplete="new-password" required minLength={14} value={confirm} onChange={e=>setConfirm(e.target.value)} className="mt-2 w-full rounded-xl border p-3"/></label>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<button disabled={busy} className="w-full rounded-xl bg-[#0b3a82] p-3 font-semibold text-white disabled:opacity-50">{busy ? "Guardando…" : "Cambiar contraseña"}</button></form></main>;
}
