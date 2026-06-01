ALTER TABLE `orders` ADD `tradeMode` enum('cash','credit') NOT NULL DEFAULT 'cash';--> statement-breakpoint
ALTER TABLE `orders` ADD `creditType` varchar(2);--> statement-breakpoint
ALTER TABLE `orders` ADD `loanDate` varchar(8);
