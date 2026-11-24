import type { ReactNode } from "react";
import { getCurrentCorporateUser } from "@/lib/auth/corporate-auth";
import { hasModulePermission } from "@/lib/cpanel/module-access";
import CpanelAccessRestricted from "@/components/cpanel-access-restricted";
import { redirect } from "next/navigation";
export default async function Layout({ children }: { children: ReactNode }) {
  const user = await getCurrentCorporateUser();
  if (!user) redirect("/login");
  if (user.passwordMustChange) redirect("/change-password");
  if (!(await hasModulePermission(user, "purchases"))) return <CpanelAccessRestricted moduleName="Compras" />;
  return <>{children}</>;
}
