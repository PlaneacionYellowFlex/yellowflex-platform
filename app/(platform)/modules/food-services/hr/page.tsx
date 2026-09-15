import HrBillingDashboard from "@/components/food-services/hr-billing-dashboard";
import HrExtraordinaryDashboard from "@/components/food-services/hr-extraordinary-dashboard";
import PageHeader from "@/components/page-header";

export default function FoodServicesHrPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Food Services · RH" title="Administración y cobros" description="Consulta pedidos, administra consumos extraordinarios y conserva la trazabilidad financiera y operativa de Food Services." />
      <HrExtraordinaryDashboard />
      <HrBillingDashboard />
    </div>
  );
}
