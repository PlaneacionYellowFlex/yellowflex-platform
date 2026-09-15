import PageHeader from "@/components/page-header";
import TimeControlDashboard from "@/components/rrhh/time-control-dashboard";
import { getEmployees } from "@/lib/rrhh/service";
import { getTimeControlSummary } from "@/lib/rrhh/time-control-service";

export const dynamic = "force-dynamic";

export default async function TimeControlPage() {
  const [employees, summary] = await Promise.all([
    getEmployees(),
    getTimeControlSummary(),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="YellowFlex · Recursos Humanos"
        title="Control de tiempo"
        description="Administración de tiempo pendiente, incidencias, reposiciones y trazabilidad por colaborador."
      />

      <TimeControlDashboard
        initialEmployees={employees}
        initialSummary={summary}
      />
    </div>
  );
}