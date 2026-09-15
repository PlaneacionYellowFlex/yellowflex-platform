"use client";

import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type LoginResponse = {
  data?: {
    user: {
      id: string;
      name: string;
      email: string;
      roles: string[];
      passwordMustChange: boolean;
    };
  };
  error?: string;
};

function getDestination(roles: string[]) {
  if (roles.includes("RH")) {
    return "/modules/rrhh";
  }

  if (roles.includes("CHEF")) {
    return "/modules/food-services/chef";
  }

  return "/dashboard";
}

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loading) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const result = (await response.json()) as LoginResponse;

      if (!response.ok || !result.data) {
        setError(
          result.error ??
            "No fue posible iniciar sesión. Intenta nuevamente.",
        );
        return;
      }

      const destination = getDestination(result.data.user.roles);

      router.replace(destination);
      router.refresh();
    } catch {
      setError(
        "No fue posible comunicarse con YellowFlex Platform.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#F7F9FC]">
      <div className="absolute inset-x-0 top-0 h-1 bg-[#F4B400]" />

      <div className="absolute -right-32 -top-32 size-[420px] rounded-full bg-blue-100/40 blur-3xl" />
      <div className="absolute -bottom-40 -left-32 size-[420px] rounded-full bg-amber-100/40 blur-3xl" />

      <div className="relative grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
        <section className="hidden items-center px-12 lg:flex xl:px-20">
          <div className="max-w-xl">
            <div className="flex items-center gap-4">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-[#0B3A82] text-lg font-black text-[#F4B400] shadow-lg shadow-blue-950/10">
                YF
              </span>

              <div>
                <p className="text-sm font-bold tracking-[0.18em] text-[#0B3A82]">
                  YELLOWFLEX
                </p>
                <p className="text-sm text-slate-500">
                  Corporate Platform
                </p>
              </div>
            </div>

            <h1 className="mt-12 text-5xl font-black leading-[1.08] tracking-[-0.04em] text-slate-950">
              Una plataforma.
              <br />
              Una sola fuente
              <br />
              <span className="text-[#0B3A82]">de verdad.</span>
            </h1>

            <p className="mt-7 max-w-lg text-lg leading-8 text-slate-500">
              Operación, personas y servicios corporativos conectados
              dentro del ecosistema digital de YellowFlex.
            </p>

            <div className="mt-10 flex items-center gap-3 text-sm font-semibold text-slate-600">
              <span className="flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
                <ShieldCheck className="size-5 text-[#0B3A82]" />
              </span>
              Acceso protegido mediante credenciales corporativas.
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center p-5 sm:p-8 lg:p-12">
          <div className="w-full max-w-md">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <span className="flex size-11 items-center justify-center rounded-xl bg-[#0B3A82] text-sm font-black text-[#F4B400]">
                YF
              </span>

              <div>
                <p className="text-sm font-bold text-[#0B3A82]">
                  YellowFlex
                </p>
                <p className="text-xs text-slate-500">
                  Corporate Platform
                </p>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/[0.06] sm:p-9">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-blue-50 text-[#0B3A82]">
                <LockKeyhole className="size-5" />
              </span>

              <h2 className="mt-6 text-3xl font-black tracking-[-0.03em] text-slate-950">
                Bienvenido
              </h2>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Ingresa con tus credenciales de YellowFlex para
                continuar.
              </p>

              <form
                onSubmit={handleSubmit}
                className="mt-8 space-y-5"
              >
                <div>
                  <label
                    htmlFor="email"
                    className="text-sm font-bold text-slate-700"
                  >
                    Correo corporativo
                  </label>

                  <div className="relative mt-2">
                    <Mail className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />

                    <input
                      id="email"
                      type="email"
                      autoComplete="username"
                      value={email}
                      onChange={(event) =>
                        setEmail(event.target.value)
                      }
                      placeholder="nombre@yellowflex.com"
                      disabled={loading}
                      required
                      className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-[#0B3A82] focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:bg-slate-50"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="text-sm font-bold text-slate-700"
                  >
                    Contraseña
                  </label>

                  <div className="relative mt-2">
                    <LockKeyhole className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />

                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) =>
                        setPassword(event.target.value)
                      }
                      disabled={loading}
                      required
                      className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-12 text-sm text-slate-950 outline-none transition focus:border-[#0B3A82] focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:bg-slate-50"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setShowPassword((current) => !current)
                      }
                      disabled={loading}
                      aria-label={
                        showPassword
                          ? "Ocultar contraseña"
                          : "Mostrar contraseña"
                      }
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-[#0B3A82]"
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                </div>

                {error ? (
                  <div
                    role="alert"
                    className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium leading-5 text-red-700"
                  >
                    {error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#0B3A82] px-5 text-sm font-bold text-white shadow-lg shadow-blue-950/10 transition hover:bg-[#082E68] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loading ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      Validando acceso...
                    </>
                  ) : (
                    <>
                      Iniciar sesión
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-7 border-t border-slate-100 pt-6">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#B77900]" />

                  <p className="text-xs leading-5 text-slate-400">
                    El acceso y los permisos son administrados por
                    YellowFlex. No compartas tus credenciales.
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-6 text-center text-xs text-slate-400">
              YellowFlex Platform · Acceso corporativo
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}