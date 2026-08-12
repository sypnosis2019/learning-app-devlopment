-- CreateTable
CREATE TABLE "AutoFulfillmentRoutingSetting" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "fallbackLocationId" TEXT,
    "normalLocationIds" JSONB NOT NULL DEFAULT []
);
