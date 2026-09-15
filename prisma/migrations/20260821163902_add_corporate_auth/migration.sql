-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "passwordMustChange" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "passwordUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CorporateSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CorporateSession_tokenHash_key" ON "CorporateSession"("tokenHash");

-- CreateIndex
CREATE INDEX "CorporateSession_userId_expiresAt_idx" ON "CorporateSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "CorporateSession_expiresAt_idx" ON "CorporateSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "CorporateSession" ADD CONSTRAINT "CorporateSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
