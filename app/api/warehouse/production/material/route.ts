import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { listProductionAvailableCustodies } from "@/repositories/warehouse-custody.repository";

async function access() {
  const user = await requireCorporateUser();
  if (user.roles.some((r) => r === "ADMIN" || r === "DIRECCION" || r === "PRODUCCION")) return user;
  throw new CorporateAuthorizationRequired("No tienes permiso para operar material de Producción.");
}
export async function GET() {
  try {
    await access();
    const rows = await listProductionAvailableCustodies();
    return NextResponse.json({ custodies: rows.map((c) => ({ id:c.id, folio:c.folio, quantity:c.quantity.toNumber(), unit:c.unit, enteredAt:c.enteredAt, referenceType:c.referenceType, referenceNumber:c.referenceNumber, notes:c.notes, item:{id:c.item.id,code:c.item.code,description:c.item.description}, custodianArea:{code:c.custodianArea.code,name:c.custodianArea.name} })) });
  } catch (error) { return apiError(error); }
}
