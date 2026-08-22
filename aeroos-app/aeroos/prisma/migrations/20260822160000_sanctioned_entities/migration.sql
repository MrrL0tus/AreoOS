-- CreateTable
CREATE TABLE "sanctioned_entities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "program" TEXT,
    "source" TEXT NOT NULL,
    "listDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanctioned_entities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sanctioned_entities_name_idx" ON "sanctioned_entities"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sanctioned_entities_name_source_key" ON "sanctioned_entities"("name", "source");
