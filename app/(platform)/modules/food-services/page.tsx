import { ArrowRight, ChefHat, UsersRound, Utensils } from "lucide-react";
import Link from "next/link";
import PageHeader from "@/components/page-header";
import { getCurrentCorporateUser } from "@/lib/auth/corporate-auth";
import { canEnterFoodServices } from "@/lib/food-services/self-service";
import CpanelAccessRestricted from "@/components/cpanel-access-restricted";
import { hasFoodServicesRhAccess } from "@/lib/food-services/rh-authorization";

export default async function FoodServicesPage() {
  const user = await getCurrentCorporateUser();
  if (!user || !(await canEnterFoodServices(user))) return <CpanelAccessRestricted moduleName="Food Services" />;
  const canManage = await hasFoodServicesRhAccess(user);
  const areas = [
    { title: "Portal del empleado", description: "Consulta el menú y tus reservas.", href: "/modules/food-services/employee", icon: Utensils, visible: Boolean(user.employee) },
    { title: "Gestión de menú", description: "Área exclusiva del chef.", href: "/modules/food-services/chef", icon: ChefHat, visible: user.roles.includes("ADMIN") || user.roles.includes("CHEF") },
    { title: "Administración RH", description: "Gestión y cobros del comedor.", href: "/modules/food-services/hr", icon: UsersRound, visible: canManage },
  ].filter(area => area.visible);
  return <div className="space-y-8">
    <PageHeader eyebrow="Módulo corporativo" title="Food Services" description="Comedor industrial y servicios para colaboradores." />
    <section className="grid gap-4 md:grid-cols-2">{areas.map(({title,description,href,icon:Icon}) =>
      <Link key={href} href={href} className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-blue-200 hover:shadow-lg">
        <span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-[#0b3a82]"><Icon className="size-5" /></span>
        <h2 className="mt-5 text-lg font-bold text-slate-900">{title}</h2><p className="mt-2 text-sm text-slate-500">{description}</p>
        <span className="mt-5 flex items-center gap-2 text-sm font-bold text-[#0b3a82]">Abrir área <ArrowRight className="size-4" /></span>
      </Link>)}</section>
  </div>;
}
