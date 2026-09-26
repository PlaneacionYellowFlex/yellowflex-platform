import { stat } from "node:fs/promises";

import type { OeeWorkbookData } from "@/types/oee";

type OeeWorkbookFileSignature = {
  filePath: string;
  size: number;
  modifiedAtMs: number;
};

let cache: OeeWorkbookData | null = null;
let cacheSignature: OeeWorkbookFileSignature | null = null;

async function getFileSignature(): Promise<OeeWorkbookFileSignature> {
  const filePath = process.env.OEE_MASTER_PATH;

  if (!filePath) {
    throw new Error(
      "No está configurada la variable OEE_MASTER_PATH en el entorno.",
    );
  }

  const fileStat = await stat(filePath);

  if (!fileStat.isFile()) {
    throw new Error(
      `La ruta configurada en OEE_MASTER_PATH no corresponde a un archivo: ${filePath}`,
    );
  }

  return {
    filePath,
    size: fileStat.size,
    modifiedAtMs: fileStat.mtimeMs,
  };
}

function signaturesMatch(
  left: OeeWorkbookFileSignature,
  right: OeeWorkbookFileSignature,
): boolean {
  return (
    left.filePath === right.filePath &&
    left.size === right.size &&
    left.modifiedAtMs === right.modifiedAtMs
  );
}

export async function getCachedWorkbook(): Promise<OeeWorkbookData | null> {
  if (!cache || !cacheSignature) {
    return null;
  }

  const currentSignature = await getFileSignature();

  if (!signaturesMatch(cacheSignature, currentSignature)) {
    clearWorkbookCache();
    return null;
  }

  return cache;
}

export async function setCachedWorkbook(
  workbook: OeeWorkbookData,
): Promise<void> {
  cache = workbook;
  cacheSignature = await getFileSignature();
}

export function clearWorkbookCache(): void {
  cache = null;
  cacheSignature = null;
}
