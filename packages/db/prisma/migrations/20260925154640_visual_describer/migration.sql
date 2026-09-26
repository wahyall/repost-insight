-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "visual_description" TEXT,
ADD COLUMN     "visual_description_status" TEXT NOT NULL DEFAULT 'pending';
