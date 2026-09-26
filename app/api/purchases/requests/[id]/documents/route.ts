import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireCorporateUser } from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";
import { refreshPurchaseDocumentStatus } from "@/lib/purchases/purchase-document-status";
import { getMyPurchasePermissions } from "@/lib/purchases/purchase-permissions";
import { getPurchaseStorage } from "@/lib/purchases/purchase-storage";

const MAX_BYTES = 20 * 1024 * 1024;

function safeName(name: string) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-120) || "documento";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let uploadedKey: string | null = null;
  try {
    const actor = await requireCorporateUser();
    const permissions = await getMyPurchasePermissions();
    const { id } = await context.params;
    const existing = await db.purchaseRequest.findUnique({ where: { id }, select: { id: true, requesterId: true, purchasedAt: true } });
    if (!existing) return NextResponse.json({ error: "La solicitud no existe." }, { status: 404 });
    const canUpload = permissions.canManagePurchases || (permissions.canRequest && existing.requesterId === actor.id);
    if (!canUpload) return NextResponse.json({ error: "No tienes permiso para adjuntar documentos a esta solicitud." }, { status: 403 });

    const form = await request.formData();
    const file = form.get("file");
    const type = form.get("type");
    if (!(file instanceof File) || (type !== "QUOTATION" && type !== "INVOICE")) {
      return NextResponse.json({ error: "Documento o tipo de documento inválido." }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "El archivo debe pesar entre 1 byte y 20 MB." }, { status: 413 });
    const lower = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf");
    const isXml = file.type.includes("xml") || lower.endsWith(".xml");
    if (type === "QUOTATION" && !isPdf) return NextResponse.json({ error: "Las cotizaciones deben cargarse en PDF." }, { status: 422 });
    if (type === "INVOICE" && !existing.purchasedAt) return NextResponse.json({ error: "Primero registra la compra realizada antes de cargar la factura." }, { status: 422 });
    if (type === "INVOICE" && !isPdf && !isXml) return NextResponse.json({ error: "La factura debe ser PDF o XML." }, { status: 422 });

    const bytes = Buffer.from(await file.arrayBuffer());
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const extension = lower.split(".").pop() || "bin";
    const storageKey = `requests/${id}/${type.toLowerCase()}/${randomUUID()}.${extension}`;
    const { client, bucket } = getPurchaseStorage();
    const { error: uploadError } = await client.storage.from(bucket).upload(storageKey, bytes, { contentType: file.type || "application/octet-stream", upsert: false });
    if (uploadError) throw new Error(`No fue posible guardar el documento: ${uploadError.message}`);
    uploadedKey = storageKey;

    const result = await db.$transaction(async (tx) => {
      const document = await tx.purchaseDocument.create({ data: {
        requestId: id, type, originalName: safeName(file.name), storageKey,
        mimeType: file.type || (isPdf ? "application/pdf" : "application/xml"),
        sizeBytes: file.size, checksum, uploadedById: actor.id,
      }});
      await tx.purchaseEvent.create({ data: { requestId: id, actorId: actor.id, eventType: "DOCUMENT_UPLOADED", details: { documentId: document.id, type, originalName: document.originalName, mimeType: document.mimeType, sizeBytes: document.sizeBytes, checksum } } });
      const documentStatus = await refreshPurchaseDocumentStatus(tx, id, actor.id);
      return { document, documentStatus };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (uploadedKey) {
      try { const { client, bucket } = getPurchaseStorage(); await client.storage.from(bucket).remove([uploadedKey]); } catch { /* conserva error original */ }
    }
    return apiError(error);
  }
}
