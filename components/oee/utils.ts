export function formatPercent(value: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatMinutes(value: number): string {
  return Math.round(value).toLocaleString("es-MX");
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getUtilizationColor(utilization: number): string {
  if (utilization >= 0.9) {
    return "text-emerald-600";
  }

  if (utilization >= 0.75) {
    return "text-amber-600";
  }

  return "text-red-600";
}

export function getStatusBadge(status: string): string {
  switch (status) {
    case "positive":
      return "border-emerald-300 bg-emerald-50 text-emerald-700";

    case "attention":
      return "border-amber-300 bg-amber-50 text-amber-700";

    case "critical":
      return "border-red-300 bg-red-50 text-red-700";

    default:
      return "border-slate-300 bg-slate-100 text-slate-600";
  }
}