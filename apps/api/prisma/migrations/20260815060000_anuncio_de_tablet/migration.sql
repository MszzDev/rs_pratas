-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pinChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "device_announcements" (
    "id" TEXT NOT NULL,
    "hardwareId" TEXT NOT NULL,
    "model" TEXT,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "deviceId" TEXT,

    CONSTRAINT "device_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_announcements_hardwareId_key" ON "device_announcements"("hardwareId");

-- CreateIndex
CREATE UNIQUE INDEX "device_announcements_deviceId_key" ON "device_announcements"("deviceId");

-- CreateIndex
CREATE INDEX "device_announcements_deviceId_idx" ON "device_announcements"("deviceId");

