import "server-only";

import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

import type {
  AuthenticatedUser,
  PlatformRole,
} from "@/lib/access-control";
import { db } from "@/lib/db";

const CORPORATE_SESSION_COOKIE = "yellowflex_corporate_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

export class CorporateAuthenticationRequired extends Error {
  constructor(message = "Debes iniciar sesión para continuar.") {
    super(message);
    this.name = "CorporateAuthenticationRequired";
  }
}

export class CorporateAuthorizationRequired extends Error {
  constructor(message = "No tienes permisos para realizar esta operación.") {
    super(message);
    this.name = "CorporateAuthorizationRequired";
  }
}

export class CorporateLoginError extends Error {
  constructor(message = "Correo o contraseña incorrectos.") {
    super(message);
    this.name = "CorporateLoginError";
  }
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function authenticateCorporateUser(
  email: string,
  password: string,
) {
  const normalizedEmail = normalizeEmail(email);

  const user = await db.user.findUnique({
    where: {
      email: normalizedEmail,
    },
    include: {
      roles: true,
      employee: {
        select: {
          id: true,
          employeeNumber: true,
          fullName: true,
        },
      },
    },
  });

  if (!user || !user.active || !user.passwordHash) {
    throw new CorporateLoginError();
  }

  const validPassword = await bcrypt.compare(
    password,
    user.passwordHash,
  );

  if (!validPassword) {
    throw new CorporateLoginError();
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roles: user.roles.map(
      (userRole) => userRole.role as PlatformRole,
    ),
    employee: user.employee,
    passwordMustChange: user.passwordMustChange,
  };
}

export async function createCorporateSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db.corporateSession.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  const cookieStore = await cookies();

  cookieStore.set(CORPORATE_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  return expiresAt;
}

export async function destroyCorporateSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(CORPORATE_SESSION_COOKIE)?.value;

  if (token) {
    await db.corporateSession.deleteMany({
      where: {
        tokenHash: hashSessionToken(token),
      },
    });
  }

  cookieStore.delete(CORPORATE_SESSION_COOKIE);
}

export async function getCurrentCorporateUser():
  Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CORPORATE_SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  const session = await db.corporateSession.findUnique({
    where: {
      tokenHash: hashSessionToken(token),
    },
    include: {
      user: {
        include: {
          roles: true,
          employee: {
            select: {
              id: true,
              employeeNumber: true,
              fullName: true,
            },
          },
        },
      },
    },
  });

  if (
    !session ||
    session.expiresAt <= new Date() ||
    !session.user.active
  ) {
    if (session) {
      await db.corporateSession.deleteMany({
        where: {
          id: session.id,
        },
      });
    }

    return null;
  }

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    roles: session.user.roles.map(
      (userRole) => userRole.role as PlatformRole,
    ),
    employee: session.user.employee,
  };
}

export async function requireCorporateUser() {
  const user = await getCurrentCorporateUser();

  if (!user) {
    throw new CorporateAuthenticationRequired();
  }

  return user;
}

export async function requireCorporateRole(
  allowedRoles: PlatformRole[],
) {
  if (allowedRoles.length === 0) {
    throw new Error(
      "Se requiere al menos un rol para proteger la operación.",
    );
  }

  const user = await requireCorporateUser();

  const authorized = user.roles.some(
    (role) =>
      role === "ADMIN" ||
      allowedRoles.includes(role),
  );

  if (!authorized) {
    throw new CorporateAuthorizationRequired();
  }

  return user;
}

export async function deleteExpiredCorporateSessions() {
  return db.corporateSession.deleteMany({
    where: {
      expiresAt: {
        lte: new Date(),
      },
    },
  });
}