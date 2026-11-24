import "server-only";

import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import CpanelAccessRestricted from "@/components/cpanel-access-restricted";
import { getCurrentCorporateUser } from "@/lib/auth/corporate-auth";
import { hasCpanelPermission } from "@/lib/cpanel/authorization";
import type { CpanelModule } from "@/lib/cpanel/permission-catalog";

type Props = {
  children: ReactNode;
  moduleKey: CpanelModule;
  moduleName: string;
};

/**
 * Protección de páginas durante el piloto. ADMIN conserva acceso transitorio
 * para evitar bloqueo administrativo. NO protege las API: cada endpoint
 * necesita autorización de servidor específica antes de liberarse.
 */
export default async function CpanelPageAccess({ children, moduleKey, moduleName }: Props) {
  const user = await getCurrentCorporateUser();
  if (!user) redirect("/login");

  if (user.roles.includes("ADMIN")) return <>{children}</>;

  const allowed = await hasCpanelPermission(user.id, moduleKey, "view");
  if (!allowed) return <CpanelAccessRestricted moduleName={moduleName} />;

  return <>{children}</>;
}
