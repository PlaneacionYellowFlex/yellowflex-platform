import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCorporateUser } from "@/lib/auth/corporate-auth";
import { hasFoodServicesRhAccess } from "@/lib/food-services/rh-authorization";
import CpanelAccessRestricted from "@/components/cpanel-access-restricted";
import HrPayrollBatches from "@/components/food-services/hr-payroll-batches";
import PageHeader from "@/components/page-header";

export default async function FoodServicesPayrollPage() {
  const user = await getCurrentCorporateUser();
  if (!user) redirect("/login");
  if (user.passwordMustChange) redirect("/change-password");
  if (!(await hasFoodServicesRhAccess(user))) return <CpanelAccessRestricted moduleName="Prenómina de Food Services" />;
  // Las capacidades de prenómina (consultar, generar, anular, exportar) se aplican también en cada API.
  return (
    <div className="space-y-6 bg-white">
      <PageHeader eyebrow="Food Services · RH" title="Prenómina" description="Lotes de descuento por nómina con selección explícita, referencia libre, vista previa, generación idempotente, anulación controlada y exportación oficial." />
      <Link href="/modules/food-services/hr" className="inline-flex text-sm font-bold text-[#0B3A82] hover:underline">← Volver a Administración y cobros</Link>
      <HrPayrollBatches />
    </div>
  );
}
