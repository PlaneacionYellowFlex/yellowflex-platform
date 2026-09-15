import "server-only";
import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

const cookieName = "yf_food_access";
const sessionMinutes = Number(process.env.FOOD_ACCESS_SESSION_MINUTES ?? 30);
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createEmployeeSession(employeeId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionMinutes * 60_000);
  await db.foodAccessSession.create({ data: { employeeId, tokenHash: hashToken(token), expiresAt } });
  const store = await cookies();
  store.set(cookieName, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
}

export async function invalidateEmployeeSessions(
  employeeId: string,
) {
  await db.foodAccessSession.deleteMany({
    where: {
      employeeId,
    },
  });

  const store = await cookies();
  store.delete(cookieName);
}
export async function getEmployeeSession() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  return db.foodAccessSession.findFirst({ where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() }, employee: { status: "ACTIVE" } }, select: { id: true, employee: { select: { id: true, employeeNumber: true, fullName: true } } } });
}
