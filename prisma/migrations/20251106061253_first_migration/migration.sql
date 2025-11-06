-- CreateEnum
CREATE TYPE "SignatureStatus" AS ENUM ('PENDING', 'VALID', 'USED_ONCHAIN', 'EXPIRED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "siweNonce" VARCHAR(128),
    "sessionToken" TEXT,
    "sessionExpires" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Split" (
    "id" SERIAL NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contract" TEXT NOT NULL,
    "splitIdOnchain" BIGINT,
    "payer" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "totalAmount" DECIMAL(78,0) NOT NULL,
    "deadline" TIMESTAMP(3),
    "metaHash" BYTEA,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Split_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SplitParticipant" (
    "id" SERIAL NOT NULL,
    "splitId" INTEGER NOT NULL,
    "participant" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "approvedOffchainAt" TIMESTAMP(3),
    "usedOnchainAt" TIMESTAMP(3),

    CONSTRAINT "SplitParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SplitSignature" (
    "id" SERIAL NOT NULL,
    "splitId" INTEGER NOT NULL,
    "participant" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "deadline" TIMESTAMP(3),
    "salt" BYTEA NOT NULL,
    "signature" BYTEA NOT NULL,
    "status" "SignatureStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SplitSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportedToken" (
    "id" SERIAL NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "decimals" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportedToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_sessionToken_key" ON "User"("sessionToken");

-- CreateIndex
CREATE INDEX "Split_chainId_contract_idx" ON "Split"("chainId", "contract");

-- CreateIndex
CREATE INDEX "Split_payer_idx" ON "Split"("payer");

-- CreateIndex
CREATE INDEX "Split_token_idx" ON "Split"("token");

-- CreateIndex
CREATE INDEX "Split_settled_createdAt_idx" ON "Split"("settled", "createdAt");

-- CreateIndex
CREATE INDEX "SplitParticipant_participant_idx" ON "SplitParticipant"("participant");

-- CreateIndex
CREATE UNIQUE INDEX "SplitParticipant_splitId_participant_key" ON "SplitParticipant"("splitId", "participant");

-- CreateIndex
CREATE INDEX "SplitSignature_participant_idx" ON "SplitSignature"("participant");

-- CreateIndex
CREATE INDEX "SplitSignature_status_createdAt_idx" ON "SplitSignature"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SplitSignature_splitId_participant_salt_key" ON "SplitSignature"("splitId", "participant", "salt");

-- CreateIndex
CREATE INDEX "SupportedToken_enabled_idx" ON "SupportedToken"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "SupportedToken_chainId_address_key" ON "SupportedToken"("chainId", "address");

-- AddForeignKey
ALTER TABLE "Split" ADD CONSTRAINT "Split_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitParticipant" ADD CONSTRAINT "SplitParticipant_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "Split"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitSignature" ADD CONSTRAINT "SplitSignature_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "Split"("id") ON DELETE CASCADE ON UPDATE CASCADE;
