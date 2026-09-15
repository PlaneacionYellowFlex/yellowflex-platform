import "server-only";

import { db } from "@/lib/db";
import type { ExtraordinaryFoodServiceInput } from "@/lib/food-services/validation";

export async function getExtraordinaryFoodServices() {
  const week = await db.menuWeek.findFirst({ where: { status: "PUBLISHED" }, orderBy: { weekStart: "desc" }, select: { id: true, weekStart: true, days: { orderBy: { serviceDate: "asc" }, select: { id: true, serviceDate: true, items: { where: { available: true, archivedAt: null }, orderBy: { serviceType: "asc" }, select: { id: true, serviceType: true, name: true, price: true } } } } } });
  if (!week) return { week: null, records: [] };
  const itemIds = week.days.flatMap((day) => day.items.map((item) => item.id));
  const records = await db.foodExtraordinaryService.findMany({ where: { menuItemId: { in: itemIds } }, orderBy: { createdAt: "desc" }, select: { id: true, guestName: true, guestType: true, company: true, quantity: true, priceApplied: true, chargeType: true, areaResponsible: true, reason: true, notes: true, status: true, createdAt: true, cancelledAt: true, authorizedBy: { select: { id: true, name: true, email: true } }, menuItem: { select: { id: true, serviceType: true, name: true, price: true, menuDay: { select: { serviceDate: true, menuWeekId: true } } } } } });
  return { week, records: records.map((record) => ({ ...record, priceApplied: record.priceApplied.toString(), menuItem: { ...record.menuItem, price: record.menuItem.price.toString() } })) };
}

export async function getExtraordinaryFoodServicesByWeek(weekId: string) {
  const records = await db.foodExtraordinaryService.findMany({ where: { status: "ACTIVE", menuItem: { menuDay: { menuWeekId: weekId } } }, orderBy: [{ menuItem: { menuDay: { serviceDate: "asc" } } }, { createdAt: "asc" }], select: { id: true, guestName: true, guestType: true, company: true, quantity: true, priceApplied: true, chargeType: true, areaResponsible: true, reason: true, notes: true, createdAt: true, authorizedBy: { select: { name: true, email: true } }, menuItem: { select: { id: true, serviceType: true, name: true, menuDay: { select: { serviceDate: true } } } } } });
  return records.map((record) => ({ ...record, priceApplied: record.priceApplied.toString() }));
}

export async function createExtraordinaryFoodService(input: ExtraordinaryFoodServiceInput, authorizedById: string) {
  const item = await db.menuItem.findUnique({ where: { id: input.menuItemId }, select: { id: true, price: true, available: true, archivedAt: true, menuDay: { select: { menuWeek: { select: { status: true } } } } } });
  if (!item || !item.available || item.archivedAt || item.menuDay.menuWeek.status !== "PUBLISHED") throw new Error("El platillo seleccionado no pertenece a un menú publicado y disponible.");
  return db.foodExtraordinaryService.create({ data: { menuItemId: item.id, guestName: input.guestName, guestType: input.guestType, company: input.company || null, quantity: input.quantity, priceApplied: item.price, chargeType: input.chargeType, areaResponsible: input.areaResponsible || null, reason: input.reason, notes: input.notes || null, authorizedById } });
}

export async function cancelExtraordinaryFoodService(id: string) {
  const record = await db.foodExtraordinaryService.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!record) throw new Error("El consumo extraordinario no existe.");
  if (record.status === "CANCELLED") return record;
  return db.foodExtraordinaryService.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
}
