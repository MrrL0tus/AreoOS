-- CreateEnum
CREATE TYPE "TenantPlan" AS ENUM ('STARTER', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "StorageRegion" AS ENUM ('EU_WEST_1', 'AP_SOUTHEAST_1', 'US_EAST_1');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ON_LEASE', 'OFF_LEASE', 'IN_TRANSITION', 'IN_MAINTENANCE', 'STORED', 'SOLD', 'PARTED_OUT');

-- CreateEnum
CREATE TYPE "EnginePosition" AS ENUM ('LEFT', 'RIGHT', 'TAIL', 'SPARE');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'NEGOTIATION', 'SIGNED', 'ACTIVE', 'REDELIVERY', 'TERMINATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('SCHEDULED', 'DUE', 'RECEIVED', 'PARTIAL', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('CERTIFICATE', 'CONTRACT', 'MAINTENANCE', 'INSPECTION', 'FINANCIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "DataQuality" AS ENUM ('CERTIFIED', 'DECLARED', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "ValuationMethod" AS ENUM ('ALGORITHMIC', 'CERTIFIED_APPRAISAL', 'MANUAL_OVERRIDE');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('CONTRACT_EXPIRY', 'PAYMENT_OVERDUE', 'INSURANCE_EXPIRY', 'MAINTENANCE_DUE', 'CERTIFICATE_EXPIRY', 'MR_RESERVE_THRESHOLD', 'CONCENTRATION_BREACH', 'SANCTIONS_FLAG', 'LLP_THRESHOLD');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "SanctionsStatus" AS ENUM ('CLEAR', 'FLAGGED', 'BLOCKED', 'NOT_CHECKED');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('A_CHECK', 'C_CHECK', 'D_CHECK', 'ENGINE_SHOP_VISIT', 'APU_OVERHAUL', 'LANDING_GEAR_OVERHAUL', 'AD_COMPLIANCE', 'SB_INCORPORATION', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'DEFERRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiExtractionStatus" AS ENUM ('PENDING', 'VALIDATED', 'REJECTED', 'PARTIAL');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "plan" "TenantPlan" NOT NULL DEFAULT 'STARTER',
    "storageRegion" "StorageRegion" NOT NULL DEFAULT 'EU_WEST_1',
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "maxAssets" INTEGER NOT NULL DEFAULT 10,
    "maxUsers" INTEGER NOT NULL DEFAULT 3,
    "concentrationLimitPct" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "contractAlertDays" INTEGER[] DEFAULT ARRAY[180, 90, 30, 7]::INTEGER[],
    "paymentAlertDays" INTEGER[] DEFAULT ARRAY[3, 7, 15]::INTEGER[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aircraft" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "msn" TEXT NOT NULL,
    "registration" TEXT,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "variant" TEXT,
    "yearBuilt" INTEGER NOT NULL,
    "deliveryDate" TIMESTAMP(3),
    "totalHours" INTEGER NOT NULL DEFAULT 0,
    "totalCycles" INTEGER NOT NULL DEFAULT 0,
    "hoursQuality" "DataQuality" NOT NULL DEFAULT 'DECLARED',
    "lastUtilizationUpdate" TIMESTAMP(3),
    "cabinConfig" TEXT,
    "seatCount" INTEGER,
    "mtowKg" INTEGER,
    "status" "AssetStatus" NOT NULL DEFAULT 'OFF_LEASE',
    "currentOperatorId" TEXT,
    "cofaExpiryDate" TIMESTAMP(3),
    "cofrExpiryDate" TIMESTAMP(3),
    "insuranceExpiryDate" TIMESTAMP(3),
    "openAdCount" INTEGER NOT NULL DEFAULT 0,
    "openSbCount" INTEGER NOT NULL DEFAULT 0,
    "portfolioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "aircraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "thrustRating" TEXT,
    "aircraftId" TEXT,
    "position" "EnginePosition",
    "totalHours" INTEGER NOT NULL DEFAULT 0,
    "totalCycles" INTEGER NOT NULL DEFAULT 0,
    "egtMargin" DOUBLE PRECISION,
    "llpCyclesRemaining" INTEGER,
    "llpLimitingPart" TEXT,
    "lastShopVisitDate" TIMESTAMP(3),
    "nextShopVisitEstimate" TIMESTAMP(3),
    "shopVisitCostEstimate" DECIMAL(14,2),
    "dataQuality" "DataQuality" NOT NULL DEFAULT 'DECLARED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "engines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "components" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "manufacturer" TEXT,
    "aircraftId" TEXT,
    "installedAt" TIMESTAMP(3),
    "totalHours" INTEGER NOT NULL DEFAULT 0,
    "totalCycles" INTEGER NOT NULL DEFAULT 0,
    "nextOverhaulDue" TIMESTAMP(3),
    "overhaulCostEstimate" DECIMAL(14,2),
    "dataQuality" "DataQuality" NOT NULL DEFAULT 'DECLARED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operators" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "iataCode" TEXT,
    "icaoCode" TEXT,
    "country" TEXT NOT NULL,
    "region" TEXT,
    "creditRating" TEXT,
    "riskScore" INTEGER,
    "riskUpdatedAt" TIMESTAMP(3),
    "sanctionsStatus" "SanctionsStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "sanctionsCheckedAt" TIMESTAMP(3),
    "sanctionsNotes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_contracts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "lessorName" TEXT NOT NULL,
    "lesseeId" TEXT NOT NULL,
    "signedDate" TIMESTAMP(3),
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "deliveryDate" TIMESTAMP(3),
    "redeliveryDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "monthlyRent" DECIMAL(14,2) NOT NULL,
    "securityDeposit" DECIMAL(14,2),
    "escalationClause" TEXT,
    "mrEngineLeft" DECIMAL(12,2),
    "mrEngineRight" DECIMAL(12,2),
    "mrApu" DECIMAL(12,2),
    "mrLandingGear" DECIMAL(12,2),
    "mrAirframe" DECIMAL(12,2),
    "governingLaw" TEXT,
    "jurisdiction" TEXT,
    "hasPurchaseOption" BOOLEAN NOT NULL DEFAULT false,
    "hasExtensionOption" BOOLEAN NOT NULL DEFAULT false,
    "hasEarlyTermination" BOOLEAN NOT NULL DEFAULT false,
    "returnConditions" TEXT,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "extractedByAi" BOOLEAN NOT NULL DEFAULT false,
    "aiExtractionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "lease_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amountDue" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "receivedDate" TIMESTAMP(3),
    "amountReceived" DECIMAL(14,2),
    "status" "PaymentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "subcategory" TEXT,
    "aircraftId" TEXT,
    "contractId" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "extractedText" TEXT,
    "aiSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "valuationDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "baseValue" DECIMAL(14,2) NOT NULL,
    "currentMarketValue" DECIMAL(14,2),
    "residualValue" DECIMAL(14,2),
    "residualValueDate" TIMESTAMP(3),
    "method" "ValuationMethod" NOT NULL DEFAULT 'ALGORITHMIC',
    "source" TEXT,
    "isCertified" BOOLEAN NOT NULL DEFAULT false,
    "calcInputs" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "valuation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "engineId" TEXT,
    "type" "MaintenanceType" NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "dueHours" INTEGER,
    "dueCycles" INTEGER,
    "estimatedCost" DECIMAL(14,2),
    "actualCost" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "mroName" TEXT,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'PLANNED',
    "completedAt" TIMESTAMP(3),
    "downtimeDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "maintenance_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "operatorId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "asset_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "aircraftId" TEXT,
    "contractId" TEXT,
    "dueDate" TIMESTAMP(3),
    "assignedToId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "ownerName" TEXT,
    "targetYieldPct" DOUBLE PRECISION,
    "inceptionDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_extractions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT,
    "promptVersion" TEXT,
    "extractedFields" JSONB NOT NULL,
    "overallConfidence" DOUBLE PRECISION NOT NULL,
    "status" "AiExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "corrections" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ai_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "result" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE INDEX "aircraft_tenantId_status_idx" ON "aircraft"("tenantId", "status");

-- CreateIndex
CREATE INDEX "aircraft_tenantId_currentOperatorId_idx" ON "aircraft"("tenantId", "currentOperatorId");

-- CreateIndex
CREATE UNIQUE INDEX "aircraft_tenantId_msn_key" ON "aircraft"("tenantId", "msn");

-- CreateIndex
CREATE INDEX "engines_tenantId_aircraftId_idx" ON "engines"("tenantId", "aircraftId");

-- CreateIndex
CREATE UNIQUE INDEX "engines_tenantId_serialNumber_key" ON "engines"("tenantId", "serialNumber");

-- CreateIndex
CREATE INDEX "components_tenantId_aircraftId_idx" ON "components"("tenantId", "aircraftId");

-- CreateIndex
CREATE UNIQUE INDEX "components_tenantId_serialNumber_partNumber_key" ON "components"("tenantId", "serialNumber", "partNumber");

-- CreateIndex
CREATE INDEX "operators_tenantId_sanctionsStatus_idx" ON "operators"("tenantId", "sanctionsStatus");

-- CreateIndex
CREATE UNIQUE INDEX "operators_tenantId_name_key" ON "operators"("tenantId", "name");

-- CreateIndex
CREATE INDEX "lease_contracts_tenantId_status_idx" ON "lease_contracts"("tenantId", "status");

-- CreateIndex
CREATE INDEX "lease_contracts_tenantId_endDate_idx" ON "lease_contracts"("tenantId", "endDate");

-- CreateIndex
CREATE INDEX "lease_contracts_tenantId_aircraftId_idx" ON "lease_contracts"("tenantId", "aircraftId");

-- CreateIndex
CREATE UNIQUE INDEX "lease_contracts_tenantId_reference_key" ON "lease_contracts"("tenantId", "reference");

-- CreateIndex
CREATE INDEX "payments_tenantId_contractId_idx" ON "payments"("tenantId", "contractId");

-- CreateIndex
CREATE INDEX "payments_tenantId_status_dueDate_idx" ON "payments"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "documents_tenantId_aircraftId_idx" ON "documents"("tenantId", "aircraftId");

-- CreateIndex
CREATE INDEX "documents_tenantId_category_idx" ON "documents"("tenantId", "category");

-- CreateIndex
CREATE INDEX "documents_tenantId_expiryDate_idx" ON "documents"("tenantId", "expiryDate");

-- CreateIndex
CREATE INDEX "valuation_records_tenantId_aircraftId_valuationDate_idx" ON "valuation_records"("tenantId", "aircraftId", "valuationDate");

-- CreateIndex
CREATE INDEX "maintenance_tasks_tenantId_aircraftId_idx" ON "maintenance_tasks"("tenantId", "aircraftId");

-- CreateIndex
CREATE INDEX "maintenance_tasks_tenantId_dueDate_status_idx" ON "maintenance_tasks"("tenantId", "dueDate", "status");

-- CreateIndex
CREATE INDEX "asset_events_tenantId_aircraftId_eventDate_idx" ON "asset_events"("tenantId", "aircraftId", "eventDate");

-- CreateIndex
CREATE INDEX "alerts_tenantId_resolvedAt_severity_idx" ON "alerts"("tenantId", "resolvedAt", "severity");

-- CreateIndex
CREATE INDEX "alerts_tenantId_aircraftId_idx" ON "alerts"("tenantId", "aircraftId");

-- CreateIndex
CREATE UNIQUE INDEX "portfolios_tenantId_name_key" ON "portfolios"("tenantId", "name");

-- CreateIndex
CREATE INDEX "ai_extractions_tenantId_status_idx" ON "ai_extractions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_resourceType_resourceId_idx" ON "audit_logs"("tenantId", "resourceType", "resourceId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aircraft" ADD CONSTRAINT "aircraft_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aircraft" ADD CONSTRAINT "aircraft_currentOperatorId_fkey" FOREIGN KEY ("currentOperatorId") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aircraft" ADD CONSTRAINT "aircraft_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engines" ADD CONSTRAINT "engines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engines" ADD CONSTRAINT "engines_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "components" ADD CONSTRAINT "components_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "components" ADD CONSTRAINT "components_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operators" ADD CONSTRAINT "operators_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_contracts" ADD CONSTRAINT "lease_contracts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_contracts" ADD CONSTRAINT "lease_contracts_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_contracts" ADD CONSTRAINT "lease_contracts_lesseeId_fkey" FOREIGN KEY ("lesseeId") REFERENCES "operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "lease_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "lease_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_records" ADD CONSTRAINT "valuation_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_records" ADD CONSTRAINT "valuation_records_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_engineId_fkey" FOREIGN KEY ("engineId") REFERENCES "engines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "lease_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
