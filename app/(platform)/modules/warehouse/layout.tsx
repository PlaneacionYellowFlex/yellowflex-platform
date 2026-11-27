import type { ReactNode } from "react";
import { getCurrentCorporateUser } from "@/lib/auth/corporate-auth";
import { hasModulePageAccess, hasModulePermission } from "@/lib/cpanel/module-access";
import CpanelAccessRestricted from "@/components/cpanel-access-restricted";
import { redirect } from "next/navigation";
export default async function Layout({ children }: { children: ReactNode }) {
  const user = await getCurrentCorporateUser();
  if (!user) redirect("/login");
  if (user.passwordMustChange) redirect("/change-password");
  // YF-003: entra quien tiene Almacén · Ver o la facultad de auditoría (consulta sin escritura).
  if (!(await hasModulePermission(user, "warehouse")) && !(await hasModulePageAccess(user, "warehouse", "audit")))
    return <CpanelAccessRestricted moduleName="Almacén" />;
  // YF-003: en todo Almacén los botones habilitados muestran puntero y los deshabilitados indican que no están disponibles.
  return (
    <div className="[&_button:disabled]:cursor-not-allowed [&_button:not(:disabled)]:cursor-pointer [&_select:not(:disabled)]:cursor-pointer">
      {children}
    </div>
  );
}
