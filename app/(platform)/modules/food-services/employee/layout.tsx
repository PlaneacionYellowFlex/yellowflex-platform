import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentCorporateUser } from "@/lib/auth/corporate-auth";
import { requireFoodEmployee } from "@/lib/food-services/self-service";
import CpanelAccessRestricted from "@/components/cpanel-access-restricted";
export default async function Layout({ children }: { children: ReactNode }) {
  const user = await getCurrentCorporateUser();
  if (!user) redirect("/login");
  if (user.passwordMustChange) redirect("/change-password");
  const employee = await requireFoodEmployee().catch(error => {
    if (error.name !== "CorporateAuthorizationRequired") throw error;
    return null;
  });
  if (!employee) return <CpanelAccessRestricted moduleName="Autoservicio de alimentos" />;
  return <>{children}</>;
}
