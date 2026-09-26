import "server-only";

import type { Prisma } from "@prisma/client";

export async function refreshPurchaseDocumentStatus(
  tx: Prisma.TransactionClient,
  requestId: string,
  actorId: string,
) {
  const request = await tx.purchaseRequest.findUnique({
    where: { id: requestId },
    select: { documentStatus: true, purchasedAt: true, completedAt: true },
  });
  if (!request) throw new Error("La solicitud no existe.");

  if (!request.purchasedAt) {
    if (request.documentStatus !== "PENDING") {
      await tx.purchaseRequest.update({
        where: { id: requestId },
        data: { documentStatus: "PENDING", completedAt: null },
      });
    }
    return "PENDING" as const;
  }

  const invoices = await tx.purchaseDocument.findMany({
    where: { requestId, type: "INVOICE", supersededAt: null },
    select: { mimeType: true, originalName: true },
  });
  const hasPdf = invoices.some(
    (d) => d.mimeType === "application/pdf" || d.originalName.toLowerCase().endsWith(".pdf"),
  );
  const hasXml = invoices.some(
    (d) => d.mimeType.includes("xml") || d.originalName.toLowerCase().endsWith(".xml"),
  );
  const next = hasPdf && hasXml ? "COMPLETE" : "INVOICE_PENDING";

  if (request.documentStatus !== next) {
    const completedAt = next === "COMPLETE" ? new Date() : null;
    await tx.purchaseRequest.update({
      where: { id: requestId },
      data: { documentStatus: next, completedAt },
    });
    if (next === "COMPLETE") {
      await tx.purchaseEvent.create({
        data: {
          requestId,
          actorId,
          eventType: "DOCUMENT_COMPLETED",
          details: { invoicePdf: true, invoiceXml: true },
        },
      });
    }
  }
  return next;
}
