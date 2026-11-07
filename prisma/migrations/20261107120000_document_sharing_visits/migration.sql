ALTER TABLE `drive_items` ADD COLUMN `sharedDepartmentIds` JSON NULL;
CREATE TABLE `drive_visits` (
  `itemId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`itemId`, `userId`),
  INDEX `drive_visits_userId_openedAt_idx` (`userId`, `openedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
