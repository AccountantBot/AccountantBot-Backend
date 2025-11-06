/*
  Warnings:

  - A unique constraint covering the columns `[telegramHandle]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "telegramHandle" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramHandle_key" ON "User"("telegramHandle");
