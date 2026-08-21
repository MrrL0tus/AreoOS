-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfaRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
