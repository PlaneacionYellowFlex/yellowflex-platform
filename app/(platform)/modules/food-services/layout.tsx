import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentCorporateUser } from "@/lib/auth/corporate-auth";
import { canEnterFoodServices } from "@/lib/food-services/self-service";
import CpanelAccessRestricted from "@/components/cpanel-access-restricted";
export default async function Layout({ children }: { children: ReactNode }) {
  const user = await getCurrentCorporateUser();
  if (!user) redirect("/login");
  if (user.passwordMustChange) redirect("/change-password");
  if (!(await canEnterFoodServices(user))) return <CpanelAccessRestricted moduleName="Food Services" />;
  return <>{children}</>;
}
