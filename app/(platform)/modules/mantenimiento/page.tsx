import { Wrench } from "lucide-react";
import ModuleLanding from "@/components/module-landing";
export default function MaintenancePage() { return <ModuleLanding title="Mantenimiento" description="Base modular para la gestión confiable de activos y la continuidad de la operación." icon={Wrench} capabilities={["Activos y ubicaciones", "Órdenes de trabajo", "Mantenimiento preventivo", "Mantenimiento correctivo", "Inventario de refacciones", "Historial y trazabilidad"]} />; }
