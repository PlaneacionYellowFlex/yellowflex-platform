import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentCorporateUser } from "@/lib/auth/corporate-auth";

export const dynamic = "force-dynamic";

export default async function CPanelLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentCorporateUser();
  if (!user) redirect("/login");
  return children;
}
