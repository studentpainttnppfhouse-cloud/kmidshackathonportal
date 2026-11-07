CREATE TABLE `calendar_entries` (
 `id` VARCHAR(191) NOT NULL, `title` VARCHAR(200) NOT NULL, `body` TEXT NULL,
 `allDay` BOOLEAN NOT NULL DEFAULT false, `summary` TEXT NULL, `nextSteps` TEXT NULL, `teamNextSteps` JSON NULL, `slidesUrl` TEXT NULL,
 `startsAt` DATETIME(3) NOT NULL, `endsAt` DATETIME(3) NULL,
 `kind` VARCHAR(20) NOT NULL DEFAULT 'event', `scope` VARCHAR(20) NOT NULL DEFAULT 'private',
 `ownerId` VARCHAR(191) NOT NULL, `departmentId` VARCHAR(191) NULL, `attendeeIds` JSON NULL,
 `location` VARCHAR(200) NULL, `deletedAt` DATETIME(3) NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
 PRIMARY KEY (`id`), INDEX `calendar_entries_startsAt_idx` (`startsAt`), INDEX `calendar_entries_ownerId_idx` (`ownerId`), INDEX `calendar_entries_departmentId_idx` (`departmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `drive_items` (
 `id` VARCHAR(191) NOT NULL, `title` VARCHAR(200) NOT NULL, `body` LONGTEXT NULL,
 `kind` VARCHAR(20) NOT NULL DEFAULT 'document', `ownerId` VARCHAR(191) NOT NULL,
 `scope` VARCHAR(20) NOT NULL DEFAULT 'private', `departmentId` VARCHAR(191) NULL, `sharedUserIds` JSON NULL,
 `deletedAt` DATETIME(3) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
 PRIMARY KEY (`id`), INDEX `drive_items_ownerId_idx` (`ownerId`), INDEX `drive_items_departmentId_idx` (`departmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `drive_submissions` (
 `id` VARCHAR(191) NOT NULL, `itemId` VARCHAR(191) NOT NULL, `assignmentId` VARCHAR(191) NOT NULL,
 `submittedById` VARCHAR(191) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`id`), UNIQUE INDEX `drive_submissions_itemId_assignmentId_key` (`itemId`,`assignmentId`), INDEX `drive_submissions_assignmentId_idx` (`assignmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- Preserve locally authored documents. External links are retained in the old table,
-- never guessed or fetched; the new drive has no external-document creation path.
INSERT INTO `drive_items` (`id`,`title`,`body`,`ownerId`,`scope`,`departmentId`,`deletedAt`,`createdAt`,`updatedAt`)
 SELECT `id`,`title`,`body`,`ownerId`,'all',`departmentId`,`deletedAt`,`createdAt`,`updatedAt` FROM `documents` WHERE `source` = 'portal';
UPDATE `attachments` SET `parentType`='drive' WHERE `parentType`='document' AND `parentId` IN (SELECT `id` FROM `drive_items`);
INSERT INTO `drive_submissions` (`id`,`itemId`,`assignmentId`,`submittedById`)
 SELECT CONCAT('m_',`id`),`id`,`assignmentId`,`ownerId` FROM `documents` WHERE `source`='portal' AND `assignmentId` IS NOT NULL;
-- The migrated copies are now the source of truth; archive the old records so
-- legacy search and assistant tools cannot bypass new drive sharing rules.
UPDATE `documents` SET `deletedAt`=COALESCE(`deletedAt`,CURRENT_TIMESTAMP(3)) WHERE `source`='portal';

-- Move existing meetings and events with their attachments, summaries and team notes.
INSERT INTO `calendar_entries` (`id`,`title`,`body`,`startsAt`,`endsAt`,`kind`,`scope`,`ownerId`,`departmentId`,`location`,`allDay`,`summary`,`nextSteps`,`teamNextSteps`,`slidesUrl`,`createdAt`,`updatedAt`)
SELECT `id`,`title`,`notes`,`startsAt`,`endsAt`,IF(`isMeeting`,'meeting','event'),IF(`departmentId` IS NULL,'all','department'),`createdById`,`departmentId`,`location`,`allDay`,`summary`,`nextSteps`,`teamNextSteps`,`slidesUrl`,`createdAt`,`updatedAt` FROM `calendar_events`;
-- Meeting attachment parent ids stay the same.
