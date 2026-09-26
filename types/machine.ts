export interface Machine {
  id: string;
  name: string;
  process: string;
  area: string;
  status: "ACTIVE" | "STOPPED" | "MAINTENANCE";
}