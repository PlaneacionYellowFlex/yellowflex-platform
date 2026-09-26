import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { requireCorporateUser } from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";
import { getMyPurchasePermissions } from "@/lib/purchases/purchase-permissions";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCorporateUser();
    const permissions = await getMyPurchasePermissions();
    const { id } = await context.params;
    const purchaseRequest = await db.purchaseRequest.findUnique({
      where: { id },
      include: {
        requester: { select: { id: true, name: true, email: true } },
        items: { orderBy: { position: "asc" } },
        decisions: { include: { decidedBy: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "desc" } },
        events: { include: { actor: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } },
        documents: { where: { supersededAt: null }, include: { uploadedBy: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!purchaseRequest) return NextResponse.json({ error: "La solicitud no existe." }, { status: 404 });
    if (!permissions.canViewAll && !permissions.canManagePurchases && !(permissions.canRequest && purchaseRequest.requesterId === user.id)) {
      return NextResponse.json({ error: "No tienes permiso para consultar esta solicitud." }, { status: 403 });
    }
    return NextResponse.json({ request: purchaseRequest });
  } catch (error) { return apiError(error); }
}
