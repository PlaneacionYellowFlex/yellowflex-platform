import { redirect } from "next/navigation";
import { getCurrentCorporateUser } from "@/lib/auth/corporate-auth";
import { hasFoodServicesRhAccess } from "@/lib/food-services/rh-authorization";
import CpanelAccessRestricted from "@/components/cpanel-access-restricted";
import HrOrderCancellations from "@/components/food-services/hr-order-cancellations";
import HrBillingDashboard from "@/components/food-services/hr-billing-dashboard";
import HrExtraordinaryDashboard from "@/components/food-services/hr-extraordinary-dashboard";
import PageHeader from "@/components/page-header";

export default async function FoodServicesHrPage() {
  const user = await getCurrentCorporateUser();
  if (!user) redirect("/login");
  if (user.passwordMustChange) redirect("/change-password");
  const allowed = await hasFoodServicesRhAccess(user);
  if (!allowed) return <CpanelAccessRestricted moduleName="Administración de Food Services" />;
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Food Services · RH" title="Administración y cobros" description="Consulta pedidos, administra consumos extraordinarios y conserva la trazabilidad financiera y operativa de Food Services." />
      <HrExtraordinaryDashboard />
      <HrOrderCancellations />
      <HrBillingDashboard />
    </div>
  );
}
