import { db } from "@/lib/db";

export async function listDiscrepancies() {
  return db.warehouseDiscrepancy.findMany({
    include: { count: { include: { item: true, location: true } }, assignedTo: { select: { id: true, name: true } }, recounts: { orderBy: { requestedAt: "desc" }, include: { requestedBy: { select: { name: true } }, completedBy: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateDiscrepancy(id: string, data: {
  classification: "CONTROLLED_TEST" | "REAL";
  cause: string;
  notes: string;
  resolution: string;
  close: boolean;
  actorId: string;
}) {
  return db.$transaction(async tx => {
    const previous = await tx.warehouseDiscrepancy.findUnique({ where: { id } });
    if (!previous) throw new Error("La investigación no existe.");
    if (previous.status === "CLOSED") throw new Error("La investigación ya está cerrada.");
    if (data.close && (!data.cause.trim() || !data.resolution.trim())) {
      throw new Error("Para cerrar se requiere causa y resolución.");
    }
    if (data.close && data.classification === "REAL") {
      throw new Error("Las diferencias reales requieren un flujo posterior de reconteo y autorización. No pueden cerrarse en esta versión.");
    }
    return tx.warehouseDiscrepancy.update({
      where: { id },
      data: {
        classification: data.classification,
        cause: data.cause.trim() || null,
        notes: data.notes.trim() || null,
        resolution: data.resolution.trim() || null,
        status: data.close ? "CLOSED" : "IN_INVESTIGATION",
        closedAt: data.close ? new Date() : null,
        assignedToId: data.actorId,
      },
    });
  });
}
