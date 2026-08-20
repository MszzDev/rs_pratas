-- DropForeignKey
ALTER TABLE "time_clock_entries" DROP CONSTRAINT "time_clock_entries_deviceId_fkey";

-- AlterTable
ALTER TABLE "time_clock_entries" ALTER COLUMN "deviceId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "time_clock_entries" ADD CONSTRAINT "time_clock_entries_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

