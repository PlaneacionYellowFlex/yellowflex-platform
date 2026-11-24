import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentCorporateUser } from "@/lib/auth/corporate-auth";
import { hasControlTowerAccess } from "@/lib/cpanel/module-access";
import CpanelAccessRestricted from "@/components/cpanel-access-restricted";
export default async function ControlTowerLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentCorporateUser();
  if (!user) redirect("/login");
  if (user.passwordMustChange) redirect("/change-password");
  if (!hasControlTowerAccess(user)) return <CpanelAccessRestricted moduleName="Control Tower" />;
  return <>{children}</>;
}
