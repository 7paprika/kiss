ALTER TABLE `auto_trader_config` ADD `entryCashPct` decimal(5,2) DEFAULT '10.00';--> statement-breakpoint
ALTER TABLE `auto_trader_config` ADD `riskPerTradePct` decimal(5,2) DEFAULT '1.00';--> statement-breakpoint
ALTER TABLE `auto_trader_config` ADD `maxPortfolioExposurePct` decimal(5,2) DEFAULT '50.00';