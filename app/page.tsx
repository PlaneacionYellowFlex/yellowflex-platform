export default function Home() {
  const modules = [
    {
      name: "Food Services",
      description: "Menús, reservaciones, consumos y control operativo.",
      status: "Primer módulo",
      icon: "🍽️",
    },
    {
      name: "Recursos Humanos",
      description: "Empleados, asistencia, capacitación y desempeño.",
      status: "Próximamente",
      icon: "👥",
    },
    {
      name: "Control Tower",
      description: "Producción, OEE, planeación e inteligencia operativa.",
      status: "Integración futura",
      icon: "📊",
    },
  ]

  return (
    <main className="min-h-screen bg-[#F6F8FC] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-6 px-6 py-4 lg:px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0B3A82] shadow-lg shadow-blue-950/15">
              <span className="text-xl font-black text-[#F4B400]">YF</span>
            </div>

            <div>
              <p className="text-xl font-extrabold tracking-tight text-[#0B3A82]">
                YELLOWFLEX
              </p>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#F4B400]">
                Corporate Platform
              </p>
            </div>
          </div>

          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold text-slate-900">
              Plataforma corporativa
            </p>
            <p className="text-xs text-slate-500">
              Operación, personas e inteligencia
            </p>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-10 lg:px-8 lg:py-16">
        <div className="relative overflow-hidden rounded-[2rem] bg-[#0B3A82] px-6 py-10 text-white shadow-2xl shadow-blue-950/20 sm:px-10 lg:px-14 lg:py-14">
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[#F4B400]/20 blur-3xl" />
          <div className="absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-white/10 blur-3xl" />

          <div className="relative z-10 grid gap-10 lg:grid-cols-[1.35fr_0.65fr] lg:items-center">
            <div>
              <div className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-[#F4B400]">
                YellowFlex Digital Ecosystem
              </div>

              <h1 className="mt-6 max-w-3xl text-4xl font-black leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                Una sola plataforma para dirigir toda la operación.
              </h1>

              <p className="mt-6 max-w-2xl text-base leading-7 text-blue-100 sm:text-lg">
                Usuarios, roles, módulos y datos corporativos conectados bajo una
                misma arquitectura.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  className="rounded-2xl bg-[#F4B400] px-7 py-4 text-sm font-extrabold text-[#0B3A82] shadow-lg transition hover:-translate-y-0.5 hover:bg-[#FFD24A]"
                >
                  Iniciar sesión
                </button>

                <button
                  type="button"
                  className="rounded-2xl border border-white/25 bg-white/10 px-7 py-4 text-sm font-bold text-white transition hover:bg-white/15"
                >
                  Conocer la plataforma
                </button>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/15 bg-white/10 p-6 backdrop-blur-md">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F4B400]">
                Estado inicial
              </p>

              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between rounded-2xl bg-white/10 p-4">
                  <span className="text-sm text-blue-100">Plataforma base</span>
                  <span className="rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-bold text-emerald-200">
                    Activa
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-white/10 p-4">
                  <span className="text-sm text-blue-100">Autenticación</span>
                  <span className="rounded-full bg-[#F4B400]/20 px-3 py-1 text-xs font-bold text-[#FFD24A]">
                    En desarrollo
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-white/10 p-4">
                  <span className="text-sm text-blue-100">Food Services</span>
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white">
                    Siguiente
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section className="mt-12">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#F4B400]">
                Ecosistema YellowFlex
              </p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-[#0B3A82]">
                Módulos corporativos
              </h2>
            </div>

            <p className="max-w-xl text-sm leading-6 text-slate-500">
              Cada módulo compartirá usuarios, departamentos, permisos,
              auditoría y diseño institucional.
            </p>
          </div>

          <div className="mt-7 grid gap-6 md:grid-cols-3">
            {modules.map((module) => (
              <article
                key={module.name}
                className="group rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0B3A82] text-2xl shadow-lg shadow-blue-950/10">
                    {module.icon}
                  </div>

                  <span className="rounded-full bg-[#F4B400]/15 px-3 py-1 text-xs font-bold text-[#0B3A82]">
                    {module.status}
                  </span>
                </div>

                <h3 className="mt-6 text-xl font-extrabold text-slate-950">
                  {module.name}
                </h3>

                <p className="mt-3 text-sm leading-6 text-slate-500">
                  {module.description}
                </p>

                <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${
                      module.name === "Food Services"
                        ? "w-1/3 bg-[#F4B400]"
                        : "w-[8%] bg-[#0B3A82]"
                    }`}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-12 grid gap-6 lg:grid-cols-[1fr_1fr]">
          <article className="rounded-[1.75rem] border border-slate-200 bg-white p-7 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#F4B400]">
              Arquitectura compartida
            </p>

            <h3 className="mt-3 text-2xl font-black text-[#0B3A82]">
              Una sola fuente de identidad
            </h3>

            <p className="mt-4 text-sm leading-6 text-slate-600">
              RH administrará empleados, departamentos y accesos. Cada usuario
              ingresará a los módulos permitidos según su rol.
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3">
              {["Usuarios", "Roles", "Departamentos", "Auditoría"].map(
                (item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-bold text-slate-700"
                  >
                    {item}
                  </div>
                ),
              )}
            </div>
          </article>

          <article className="rounded-[1.75rem] bg-[#F4B400] p-7 text-[#0B3A82] shadow-xl shadow-amber-200/40">
            <p className="text-xs font-black uppercase tracking-[0.2em]">
              Primera entrega
            </p>

            <h3 className="mt-3 text-2xl font-black">
              YellowFlex Food Services
            </h3>

            <p className="mt-4 text-sm font-medium leading-6">
              El chef podrá publicar menús y consultar cantidades. RH podrá
              administrar empleados y cobros. Los colaboradores podrán reservar
              sus alimentos.
            </p>

            <div className="mt-6 rounded-2xl bg-white/50 p-5">
              <p className="text-sm font-black">Objetivo inmediato</p>
              <p className="mt-2 text-sm">
                Entregar una versión funcional instalada en el servidor
                corporativo.
              </p>
            </div>
          </article>
        </section>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <p className="font-semibold text-[#0B3A82]">
            YellowFlex Corporate Platform
          </p>
          <p>Versión inicial · Plataforma base</p>
        </div>
      </footer>
    </main>
  )
}