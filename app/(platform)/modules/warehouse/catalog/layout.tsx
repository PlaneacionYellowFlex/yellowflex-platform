import type { ReactNode } from "react";
import ModulePageAccess from "@/lib/cpanel/module-page-access";
export default function Layout({ children }: { children: ReactNode }) {
  return <ModulePageAccess module="warehouse" action="manage-catalog" area="catalog">{children}</ModulePageAccess>;
}
