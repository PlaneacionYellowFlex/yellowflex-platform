import ModulePageAccess from "@/lib/cpanel/module-page-access";
import Content from "./page-content";
export default function Page() {
  return <ModulePageAccess module="purchases"><Content /></ModulePageAccess>;
}
