-- DropForeignKey
ALTER TABLE `extracted_processes` DROP FOREIGN KEY `extracted_processes_parseJobId_fkey`;

-- DropForeignKey
ALTER TABLE `parse_jobs` DROP FOREIGN KEY `parse_jobs_bootstrapJobId_fkey`;

-- AddForeignKey
ALTER TABLE `parse_jobs` ADD CONSTRAINT `parse_jobs_bootstrapJobId_fkey` FOREIGN KEY (`bootstrapJobId`) REFERENCES `bootstrap_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `extracted_processes` ADD CONSTRAINT `extracted_processes_parseJobId_fkey` FOREIGN KEY (`parseJobId`) REFERENCES `parse_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
