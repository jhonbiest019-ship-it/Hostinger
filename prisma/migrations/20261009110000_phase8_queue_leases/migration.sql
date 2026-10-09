-- Add explicit delivery state and claim leases for crash-safe queue recovery.
ALTER TABLE `scheduledjob`
    ADD COLUMN `deliveryState` ENUM('NOT_STARTED', 'IN_FLIGHT', 'UNKNOWN', 'CONFIRMED') NOT NULL DEFAULT 'NOT_STARTED',
    ADD COLUMN `leaseExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `leaseToken` VARCHAR(64) NULL;

-- Coordinate queue and per-mailbox inbox-sync workers without an external service.
CREATE TABLE `WorkerLease` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `ownerToken` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `WorkerLease_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
