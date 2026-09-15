import type { LucideIcon } from "lucide-react";
import {
  Building2,
  ChartNoAxesCombined,
  ChefHat,
  ClipboardCheck,
  LayoutDashboard,
  PackageSearch,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Warehouse,
  Wrench,
} from "lucide-react";

export type NavigationItem = {
  label: string;
  href?: string;
  icon: LucideIcon;
  description: string;
  comingSoon?: boolean;
};

export const primaryNavigation: NavigationItem[] = [
  {
    label: "Inicio",
    href: "/dashboard",
    icon: LayoutDashboard,
    description: "Visión general de la plataforma",
  },
  {
    label: "Food Services",
    href: "/modules/food-services",
    icon: ChefHat,
    description: "Comedor y servicios alimentarios",
  },
  {
    label: "Recursos Humanos",
    href: "/modules/rrhh",
    icon: Building2,
    description: "Personas y organización",
  },
  {
    label: "Control Tower",
    href: "/modules/control-tower",
    icon: ChartNoAxesCombined,
    description: "Inteligencia operativa",
  },
  {
    label: "Mantenimiento",
    href: "/modules/mantenimiento",
    icon: Wrench,
    description: "Gestión de activos",
  },
];

export const futureNavigation: NavigationItem[] = [
  {
    label: "Compras",
    icon: ShoppingCart,
    description: "Abastecimiento y proveedores",
    comingSoon: true,
  },
  {
    label: "Almacén",
    icon: Warehouse,
    description: "Inventarios y movimientos",
    comingSoon: true,
  },
  {
    label: "Calidad",
    icon: ClipboardCheck,
    description: "Calidad y Producto No Conforme",
    comingSoon: true,
  },
  {
    label: "Mejora Continua",
    icon: Sparkles,
    description: "Proyectos e iniciativas de mejora",
    comingSoon: true,
  },
  {
    label: "Vigilancia",
    icon: ShieldCheck,
    description: "Seguridad y control de accesos",
    comingSoon: true,
  },
];

export const secondaryNavigation: NavigationItem[] = [
  {
    label: "Configuración",
    href: "/settings",
    icon: Settings,
    description: "Preferencias de la plataforma",
  },
];

const pageContexts: Record<
  string,
  {
    title: string;
    section: string;
    description: string;
  }
> = {
  "/dashboard": {
    title: "Inicio",
    section: "Plataforma",
    description: "Visión general corporativa",
  },
  "/modules/food-services": {
    title: "Food Services",
    section: "Módulos",
    description: "Comedor y servicios alimentarios",
  },
  "/modules/food-services/employee": {
    title: "Mi menú",
    section: "Food Services",
    description: "Portal del empleado",
  },
  "/modules/food-services/chef": {
    title: "Gestión de menú",
    section: "Food Services",
    description: "Área de Chef",
  },
  "/modules/food-services/hr": {
    title: "Administración RH",
    section: "Food Services",
    description: "Área administrativa",
  },
  "/modules/food-services/consumption": {
    title: "Registro de consumo",
    section: "Food Services",
    description: "Operación",
  },
  "/modules/rrhh": {
    title: "Recursos Humanos",
    section: "Módulos",
    description: "Personas y organización",
  },
  "/modules/control-tower": {
    title: "Control Tower",
    section: "Módulos",
    description: "Inteligencia operativa",
  },
  "/modules/mantenimiento": {
    title: "Mantenimiento",
    section: "Módulos",
    description: "Gestión de activos",
  },
  "/settings": {
    title: "Configuración",
    section: "Plataforma",
    description: "Preferencias y administración",
  },
};

export function getPageContext(pathname: string) {
  return pageContexts[pathname] ?? pageContexts["/dashboard"];
}