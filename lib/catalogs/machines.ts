import type { MachineDefinition } from "./types";

export const MACHINE_REGISTRY: MachineDefinition[] = [
  // ==========================================================
  // INYECCIÓN
  // ==========================================================

  {
    id: "INJ_750_UCRANIA",
    officialName: "750 - UCRANIA",
    aliases: [
      "750 - UCRANIA",
      "750 UCRANIA",
      "750-UCRANIA",
      "750_UCRANIA",
      "750 Ucrania",
      "UCRANIA",
    ],
    department: "INJECTION",
    process: "INYECCION",
    nominalCapacityMinutes: 10080,
    effectiveCapacityMinutes: 10080,
    displayOrder: 1,
    color: "BLUE",
    status: "ACTIVE",
    plcId: null,
  },

  {
    id: "INJ_380_ESLOVAQUIA",
    officialName: "380 - ESLOVAQUIA",
    aliases: [
      "380 - ESLOVAQUIA",
      "380 ESLOVAQUIA",
      "380-ESLOVAQUIA",
      "380_ESLOVAQUIA",
      "380 Eslovaquia",
      "ESLOVAQUIA",
    ],
    department: "INJECTION",
    process: "INYECCION",
    nominalCapacityMinutes: 10080,
    effectiveCapacityMinutes: 10080,
    displayOrder: 2,
    color: "BLUE",
    status: "ACTIVE",
    plcId: null,
  },

  {
    id: "INJ_230_ESPANA",
    officialName: "230 - ESPAÑA",
    aliases: [
      "230 - ESPAÑA",
      "230 ESPAÑA",
      "230 ESPANA",
      "230-ESPANA",
      "230 España",
      "ESPAÑA",
      "ESPANA",
    ],
    department: "INJECTION",
    process: "INYECCION",
    nominalCapacityMinutes: 10080,
    effectiveCapacityMinutes: 10080,
    displayOrder: 3,
    color: "BLUE",
    status: "ACTIVE",
    plcId: null,
  },

  {
    id: "INJ_100_TURQUIA",
    officialName: "100 - TURQUIA",
    aliases: [
      "100 - TURQUIA",
      "100 TURQUIA",
      "100-TURQUIA",
      "100_TURQUIA",
      "100 Turquia",
      "TURQUÍA",
      "TURQUIA",
    ],
    department: "INJECTION",
    process: "INYECCION",
    nominalCapacityMinutes: 10080,
    effectiveCapacityMinutes: 10080,
    displayOrder: 4,
    color: "BLUE",
    status: "ACTIVE",
    plcId: null,
  },

  {
    id: "INJ_80_JAPON",
    officialName: "80 - JAPON",
    aliases: [
      "80 - JAPON",
      "80 JAPON",
      "80-JAPON",
      "80_JAPON",
      "80 Japon",
      "JAPÓN",
      "JAPON",
    ],
    department: "INJECTION",
    process: "INYECCION",
    nominalCapacityMinutes: 10080,
    effectiveCapacityMinutes: 10080,
    displayOrder: 5,
    color: "BLUE",
    status: "ACTIVE",
    plcId: null,
  },

  // ==========================================================
  // ROTOMOLDEO
  // ==========================================================

  {
    id: "ROTO_RISINGSUN_BA",
    officialName: "RISINGSUN BA",
    aliases: [
      "RISINGSUN BA",
      "RISING SUN BA",
    ],
    department: "ROTOMOLDING",
    process: "ROTOMOLDEO",
    nominalCapacityMinutes: 10080,
    effectiveCapacityMinutes: 10080,
    displayOrder: 6,
    color: "GOLD",
    status: "ACTIVE",
    plcId: null,
  },

  {
    id: "ROTO_RISINGSUN_BB",
    officialName: "RISINGSUN BB",
    aliases: [
      "RISINGSUN BB",
      "RISING SUN BB",
    ],
    department: "ROTOMOLDING",
    process: "ROTOMOLDEO",
    nominalCapacityMinutes: 10080,
    effectiveCapacityMinutes: 10080,
    displayOrder: 7,
    color: "GOLD",
    status: "ACTIVE",
    plcId: null,
  },

  {
    id: "ROTO_RISINGSUN_BC",
    officialName: "RISINGSUN BC",
    aliases: [
      "RISINGSUN BC",
      "RISING SUN BC",
    ],
    department: "ROTOMOLDING",
    process: "ROTOMOLDEO",
    nominalCapacityMinutes: 10080,
    effectiveCapacityMinutes: 10080,
    displayOrder: 8,
    color: "GOLD",
    status: "ACTIVE",
    plcId: null,
  },

  {
    id: "ROTO_ROTOLINES_35_B1",
    officialName: "ROTOLINES 3.5 B1",
    aliases: [
      "ROTOLINES 3.5 B1",
      "ROTOLINES 35 B1",
      "ROTOLINES3.5B1",
    ],
    department: "ROTOMOLDING",
    process: "ROTOMOLDEO",
    nominalCapacityMinutes: 10080,
    effectiveCapacityMinutes: 10080,
    displayOrder: 9,
    color: "GOLD",
    status: "ACTIVE",
    plcId: null,
  },

  {
    id: "ROTO_ROTOLINES_35_B2",
    officialName: "ROTOLINES 3.5 B2",
    aliases: [
      "ROTOLINES 3.5 B2",
      "ROTOLINES 35 B2",
      "ROTOLINES3.5B2",
    ],
    department: "ROTOMOLDING",
    process: "ROTOMOLDEO",
    nominalCapacityMinutes: 10080,
    effectiveCapacityMinutes: 10080,
    displayOrder: 10,
    color: "GOLD",
    status: "ACTIVE",
    plcId: null,
  },
];