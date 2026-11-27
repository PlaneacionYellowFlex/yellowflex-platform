import "server-only";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import CpanelAccessRestricted from "@/components/cpanel-access-restricted";
import { getCurrentCorporateUser } from "@/lib/auth/corporate-auth";
import { hasModulePageAccess } from "@/lib/cpanel/module-access";
import type { CpanelAction, CpanelModule } from "@/lib/cpanel/permission-catalog";

export async function getModulePageUser(module: CpanelModule, action: CpanelAction = "view", area = "") {
  const user = await getCurrentCorporateUser();
  if (!user) redirect("/login");
  if (user.passwordMustChange) redirect("/change-password");
  return await hasModulePageAccess(user, module, action, area) ? user : null;
}

export default async function ModulePageAccess({ children, module, action = "view", area = "" }: {
  children: ReactNode; module: CpanelModule; action?: CpanelAction; area?: string;
}) {
  if (!(await getModulePageUser(module, action, area))) return <CpanelAccessRestricted moduleName={module === "warehouse" ? "Almacén" : module} />;
  return <>{children}</>;
}
