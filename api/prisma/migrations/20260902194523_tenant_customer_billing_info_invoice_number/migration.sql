-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "address" TEXT,
ADD COLUMN     "document" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "number" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "address" TEXT,
ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "document" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");
