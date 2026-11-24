import type { PrismaClient } from "@prisma/client";
export function isolatedUrl(value?: string): string;
export function configureIsolatedConnection(): string;
export function assertIsolatedIdentity(db: PrismaClient): Promise<void>;
