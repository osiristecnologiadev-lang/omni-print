-- CreateEnum
CREATE TYPE "AgentPlatform" AS ENUM ('WINDOWS', 'LINUX');

-- AlterTable
ALTER TABLE "agent_tokens" ADD COLUMN     "last_checkin_at" TIMESTAMP(3),
ADD COLUMN     "last_seen_version" TEXT;

-- CreateTable
CREATE TABLE "agent_releases" (
    "id" TEXT NOT NULL,
    "platform" "AgentPlatform" NOT NULL,
    "version" TEXT NOT NULL,
    "major_version" INTEGER NOT NULL,
    "minor_version" INTEGER NOT NULL,
    "patch_version" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "release_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_releases_platform_version_key" ON "agent_releases"("platform", "version");
