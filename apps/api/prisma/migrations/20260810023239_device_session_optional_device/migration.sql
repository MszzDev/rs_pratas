-- DropForeignKey
ALTER TABLE "device_sessions" DROP CONSTRAINT "device_sessions_deviceId_fkey";

-- AlterTable
ALTER TABLE "device_sessions" ALTER COLUMN "deviceId" DROP NOT NULL,
ALTER COLUMN "storeId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
