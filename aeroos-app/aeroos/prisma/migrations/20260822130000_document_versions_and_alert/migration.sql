-- AlterTable
ALTER TABLE "documents" ADD COLUMN "parentDocId" TEXT;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_parentDocId_fkey" FOREIGN KEY ("parentDocId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'DOCUMENT_EXPIRY';
