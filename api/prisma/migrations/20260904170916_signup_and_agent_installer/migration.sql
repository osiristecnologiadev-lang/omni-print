-- AlterTable
ALTER TABLE "agent_releases" ADD COLUMN     "installer_file_path" TEXT,
ADD COLUMN     "installer_file_size_bytes" INTEGER;
