import ChefMenuManager from "@/components/food-services/chef-menu-manager";
import ChefProductionDashboard from "@/components/food-services/chef-production-dashboard";
import PageHeader from "@/components/page-header";

export default function ChefMenuPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Food Services · Chef"
        title="Gestión de menú semanal"
        description="Planea los servicios de la próxima semana, consulta la demanda confirmada de cocina y administra los platillos disponibles para los colaboradores."
      />

      <ChefProductionDashboard />

      <ChefMenuManager />
    </div>
  );
}
