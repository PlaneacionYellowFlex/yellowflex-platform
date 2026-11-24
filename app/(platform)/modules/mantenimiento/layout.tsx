import type { ReactNode } from "react";
import CpanelPageAccess from "@/lib/cpanel/page-access";

export default function MaintenanceLayout({ children }: { children: ReactNode }) {
  return <CpanelPageAccess moduleKey="mantenimiento" moduleName="Mantenimiento">{children}</CpanelPageAccess>;
}
