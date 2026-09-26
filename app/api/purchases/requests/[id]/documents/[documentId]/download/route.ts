import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireCorporateUser } from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";
import { getMyPurchasePermissions } from "@/lib/purchases/purchase-permissions";
import { getPurchaseStorage } from "@/lib/purchases/purchase-storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const user = await requireCorporateUser();
    const permissions = await getMyPurchasePermissions();
    const { id, documentId } = await context.params;
    const document = await db.purchaseDocument.findFirst({ where: { id: documentId, requestId: id, supersededAt: null }, include: { request: { select: { requesterId: true } } } });
    if (!document) return NextResponse.json({ error: "El documento no existe." }, { status: 404 });
    const allowed = permissions.canViewAll || permissions.canManagePurchases || (permissions.canRequest && document.request.requesterId === user.id);
    if (!allowed) return NextResponse.json({ error: "No tienes permiso para descargar este documento." }, { status: 403 });
    const { client, bucket } = getPurchaseStorage();
    const { data, error } = await client.storage.from(bucket).download(document.storageKey);
    if (error || !data) throw new Error(`No fue posible descargar el documento: ${error?.message ?? "archivo no disponible"}`);
    const bytes = await data.arrayBuffer();
    return new Response(bytes, { headers: {
      "Content-Type": document.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.originalName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    }});
  } catch (error) { return apiError(error); }
}
