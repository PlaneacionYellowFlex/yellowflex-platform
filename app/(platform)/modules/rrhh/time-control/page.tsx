import ModulePageAccess from "@/lib/cpanel/module-page-access";
import { getModulePageUser } from "@/lib/cpanel/module-page-access";
import CpanelAccessRestricted from "@/components/cpanel-access-restricted";
import PageHeader from "@/components/page-header";
import TimeControlDashboard from "@/components/rrhh/time-control-dashboard";
import { getEmployees } from "@/lib/rrhh/service";
import { getTimeControlSummary } from "@/lib/rrhh/time-control-service";

export const dynamic = "force-dynamic";

export default async function TimeControlPage() {
  if (!(await getModulePageUser("rrhh"))) return <CpanelAccessRestricted moduleName="Recursos Humanos" />;
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

      <ModulePageAccess module="rrhh" action="operate"><TimeControlDashboard
        initialEmployees={employees}
        initialSummary={summary}
      /></ModulePageAccess>
    </div>
  );
}