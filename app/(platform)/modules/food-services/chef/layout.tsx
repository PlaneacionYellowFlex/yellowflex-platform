import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import {
  CorporateAuthenticationRequired,
  CorporateAuthorizationRequired,
  requireCorporateRole,
} from "@/lib/auth/corporate-auth";

export default async function ChefLayout({
  children,
}: {
  children: ReactNode;
}) {
  try {
    await requireCorporateRole(["CHEF"]);
  } catch (error) {
    if (error instanceof CorporateAuthenticationRequired) {
      redirect("/login");
    }

    if (error instanceof CorporateAuthorizationRequired) {
      redirect("/dashboard");
    }

    throw error;
  }

  return children;
}