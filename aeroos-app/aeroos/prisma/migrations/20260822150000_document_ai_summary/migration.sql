-- AlterTable
ALTER TABLE "documents" ADD COLUMN "aiSummaryData" JSONB;
ALTER TABLE "documents" ADD COLUMN "aiSummaryModel" TEXT;
ALTER TABLE "documents" ADD COLUMN "aiSummaryFeedback" BOOLEAN;
ALTER TABLE "documents" ADD COLUMN "aiSummaryFeedbackAt" TIMESTAMP(3);
