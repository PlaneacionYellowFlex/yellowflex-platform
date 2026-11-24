import "server-only";

import {
  CorporateAuthorizationRequired,
  requireCorporateUser,
} from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";
import { hasCpanelPermission } from "@/lib/cpanel/authorization";

export type PurchasePermissionKey =
  | "canRequest"
  | "canRequestUrgent"
  | "canAuthorize"
  | "canViewAll"
  | "canManagePurchases";

export type PurchasePermissions = Record<PurchasePermissionKey, boolean>;

const NO_PERMISSIONS: Readonly<PurchasePermissions> = Object.freeze({
  canRequest: false,
  canRequestUrgent: false,
  canAuthorize: false,
  canViewAll: false,
  canManagePurchases: false,
});

export async function getMyPurchasePermissions(): Promise<PurchasePermissions> {
  const user = await requireCorporateUser();
  const record = await db.purchasePermission.findUnique({
    where: { userId: user.id },
    select: {
      canRequest: true,
      canRequestUrgent: true,
      canAuthorize: true,
      canViewAll: true,
      canManagePurchases: true,
    },
  });

  if (!record) return { ...NO_PERMISSIONS };

  // C-PANEL es una segunda barrera. Nunca eleva privilegios heredados.
  // Los permisos especializados de compras urgentes, aprobación y administración
  // permanecen sujetos a su propio registro y controles de separación.
  const [canViewModule, canOperateModule, canApproveModule, canManageModule] = user.roles.includes("ADMIN")
    ? [true, true, true, true]
    : await Promise.all([
        hasCpanelPermission(user.id, "purchases", "view"),
        hasCpanelPermission(user.id, "purchases", "operate"),
        hasCpanelPermission(user.id, "purchases", "approve"),
        hasCpanelPermission(user.id, "purchases", "manage"),
      ]);

  return {
    canRequest: canViewModule && canOperateModule && record.canRequest,
    canRequestUrgent: canViewModule && canOperateModule && record.canRequest && record.canRequestUrgent,
    canAuthorize: canViewModule && canOperateModule && canApproveModule && record.canAuthorize,
    canViewAll: canViewModule && record.canViewAll,
    canManagePurchases: canViewModule && canOperateModule && canManageModule && record.canManagePurchases,
  };
}

export async function requirePurchasePermission(
  permission: PurchasePermissionKey,
) {
  const user = await requireCorporateUser();
  const permissions = await getMyPurchasePermissions();

  if (!permissions[permission]) {
    throw new CorporateAuthorizationRequired(
      "No tienes permiso para realizar esta operación de Compras.",
    );
  }

  return user;
}

export async function requirePurchaseRequestAccess(requesterId: string) {
  const user = await requireCorporateUser();
  const permissions = await getMyPurchasePermissions();

  if (
    permissions.canViewAll ||
    (user.id === requesterId && permissions.canRequest)
  ) {
    return user;
  }

  throw new CorporateAuthorizationRequired(
    "No tienes permiso para consultar esta solicitud de Compras.",
  );
}

export async function requirePurchaseDecisionAccess(requesterId: string) {
  const user = await requirePurchasePermission("canAuthorize");

  if (user.id === requesterId) {
    throw new CorporateAuthorizationRequired(
      "No puedes autorizar una solicitud de compra propia.",
    );
  }

  return user;
}
