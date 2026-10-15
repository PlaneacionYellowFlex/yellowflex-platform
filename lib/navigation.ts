import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CalendarCheck2,
  ChartNoAxesCombined,
  ChefHat,
  ClipboardCheck,
  LayoutDashboard,
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
    label: "Mi RH",
    href: "/modules/my-rh",
    icon: CalendarCheck2,
    description: "Vacaciones, permisos e incidencias",
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
    label: "Compras",
    href: "/modules/purchases",
    icon: ShoppingCart,
    description: "Solicitudes, autorizaciones y expediente documental",
  },
  {
    label: "Mantenimiento",
    href: "/modules/mantenimiento",
    icon: Wrench,
    description: "Gestión de activos y mantenimiento",
  },
  {
    label: "Almacén",
    href: "/modules/warehouse",
    icon: Warehouse,
    description: "Inventarios y movimientos",
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

export const futureNavigation: NavigationItem[] = [];

export const secondaryNavigation: NavigationItem[] = [
  {
    label: "Configuración",
    href: "/settings",
    icon: Settings,
    description: "Preferencias y administración de la plataforma",
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
  "/modules/my-rh": {
    title: "Mi RH",
    section: "Recursos Humanos",
    description: "Vacaciones, permisos e incidencias",
  },
  "/modules/rrhh": {
    title: "Recursos Humanos",
    section: "Módulos",
    description: "Personas y organización",
  },
  "/modules/rrhh/requests": {
    title: "Solicitudes e incidencias",
    section: "Recursos Humanos",
    description: "Bandeja de autorización de RH",
  },
  "/modules/control-tower": {
    title: "Control Tower",
    section: "Módulos",
    description: "Inteligencia operativa",
  },
  "/modules/purchases": {
    title: "Compras",
    section: "Módulos",
    description: "Solicitudes y seguimiento de compras",
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
  "/settings/corporate-access": {
    title: "Usuarios y accesos",
    section: "Configuración",
    description: "Administración de accesos corporativos",
  },
};

export function getPageContext(pathname: string) {
  return pageContexts[pathname] ?? pageContexts["/dashboard"];
}
