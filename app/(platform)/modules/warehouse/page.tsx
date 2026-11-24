import ModulePageAccess from "@/lib/cpanel/module-page-access";
import Content from "./page-content";
export default async function Page() {
  return <ModulePageAccess module="warehouse"><Content /></ModulePageAccess>;
}
