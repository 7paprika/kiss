ALTER TABLE `auto_trader_config` ADD `trailingStopPct` decimal(5,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `auto_trader_config` ADD `partialTakeProfitPct` decimal(5,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `auto_trader_config` ADD `partialTakeProfitSellPct` decimal(5,2) DEFAULT '50.00';--> statement-breakpoint
ALTER TABLE `auto_trader_config` ADD `breakEvenTriggerPct` decimal(5,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `auto_trader_config` ADD `breakEvenBufferPct` decimal(5,2) DEFAULT '0.00';--> statement-breakpoint
CREATE TABLE `auto_position_states` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `stockCode` varchar(20) NOT NULL,
  `accountProfileId` int,
  `highPrice` decimal(15,2) DEFAULT '0.00',
  `avgPrice` decimal(15,2) DEFAULT '0.00',
  `partialTakeProfitExecuted` boolean NOT NULL DEFAULT false,
  `lastQty` int DEFAULT 0,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `auto_position_states_id` PRIMARY KEY(`id`),
  INDEX `auto_position_state_lookup` (`userId`, `stockCode`, `accountProfileId`)
);
