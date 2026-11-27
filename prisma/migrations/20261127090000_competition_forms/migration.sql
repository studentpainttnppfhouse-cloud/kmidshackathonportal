-- CreateTable
CREATE TABLE `competition_workflows` (
    `id` VARCHAR(191) NOT NULL,
    `formId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `track` VARCHAR(16) NOT NULL,
    `templateKey` VARCHAR(64) NOT NULL,
    `installKey` VARCHAR(96) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
    `opensAt` DATETIME(3) NULL,
    `closesAt` DATETIME(3) NULL,
    `stageHActive` BOOLEAN NOT NULL DEFAULT false,
    `settings` JSON NOT NULL,
    `definition` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `competition_workflows_formId_key`(`formId`),
    UNIQUE INDEX `competition_workflows_installKey_key`(`installKey`),
    INDEX `competition_workflows_year_track_idx`(`year`, `track`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `competition_counters` (
    `year` INTEGER NOT NULL,
    `track` VARCHAR(16) NOT NULL,
    `next` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`year`, `track`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `competition_teams` (
    `id` VARCHAR(191) NOT NULL,
    `workflowId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `track` VARCHAR(16) NOT NULL,
    `seq` INTEGER NOT NULL,
    `teamCode` VARCHAR(32) NOT NULL,
    `teamName` VARCHAR(200) NOT NULL,
    `memberCount` INTEGER NOT NULL,
    `representativeEmail` VARCHAR(254) NOT NULL,
    `registration` JSON NOT NULL,
    `schemaVersion` INTEGER NOT NULL,
    `idempotencyKey` VARCHAR(64) NOT NULL,
    `continuationHash` VARCHAR(64) NOT NULL,
    `continuationIssuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `registrationStatus` VARCHAR(16) NOT NULL DEFAULT 'registered',
    `paymentStatus` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `paymentFlag` VARCHAR(300) NULL,
    `accessChecked` BOOLEAN NOT NULL DEFAULT false,
    `finalist` BOOLEAN NOT NULL DEFAULT false,
    `staffNotes` TEXT NULL,
    `registeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `competition_teams_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `competition_teams_continuationHash_key`(`continuationHash`),
    INDEX `competition_teams_workflowId_idx`(`workflowId`),
    UNIQUE INDEX `competition_teams_year_track_seq_key`(`year`, `track`, `seq`),
    UNIQUE INDEX `competition_teams_year_track_teamCode_key`(`year`, `track`, `teamCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `competition_submissions` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `stage` VARCHAR(4) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'final',
    `payload` JSON NOT NULL,
    `schemaVersion` INTEGER NOT NULL,
    `reference` VARCHAR(40) NULL,
    `finalizedAt` DATETIME(3) NULL,
    `archiveStatus` VARCHAR(16) NOT NULL DEFAULT 'not_archived',
    `archivedAt` DATETIME(3) NULL,
    `archivedById` VARCHAR(191) NULL,
    `archiveNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `competition_submissions_reference_key`(`reference`),
    UNIQUE INDEX `competition_submissions_teamId_stage_key`(`teamId`, `stage`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

