ALTER TABLE `assignments`
  ADD COLUMN `mediaSourceId` VARCHAR(191) NULL,
  ADD COLUMN `captionTh` TEXT NULL,
  ADD COLUMN `captionEn` TEXT NULL;

CREATE UNIQUE INDEX `assignments_mediaSourceId_key` ON `assignments` (`mediaSourceId`);

ALTER TABLE `calendar_events`
  ADD COLUMN `isMeeting` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `slidesUrl` TEXT NULL,
  ADD COLUMN `summary` TEXT NULL,
  ADD COLUMN `teamNextSteps` JSON NULL,
  ADD COLUMN `nextSteps` TEXT NULL;
