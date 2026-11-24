import { getModulePageUser } from "@/lib/cpanel/module-page-access";
import { hasModulePermission } from "@/lib/cpanel/module-access";
import CpanelAccessRestricted from "@/components/cpanel-access-restricted";
import ModulePageAccess from "@/lib/cpanel/module-page-access";
﻿import ChefMenuManager from "@/components/food-services/chef-menu-manager";
import ChefProductionDashboard from "@/components/food-services/chef-production-dashboard";
import PageHeader from "@/components/page-header";

export default async function ChefMenuPage() {
  const user = await getModulePageUser("food-services", "view", "chef");
  if (!user) return <CpanelAccessRestricted moduleName="Food Services CHEF" />;
  const canExport = await hasModulePermission(user, "food-services", "audit");
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Food Services · Chef"
        title="Gestión de menú semanal"
        description="Planea los servicios de la próxima semana, consulta la demanda confirmada de cocina y administra los platillos disponibles para los colaboradores."
      />

      <ChefProductionDashboard canExport={canExport} />

      <ModulePageAccess module="food-services" action="operate" area="chef"><ChefMenuManager /></ModulePageAccess>
    </div>
  );
}
