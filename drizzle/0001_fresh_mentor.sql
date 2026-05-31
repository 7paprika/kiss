CREATE TABLE `auto_trader_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`isRunning` boolean NOT NULL DEFAULT false,
	`selectionStrategyId` int,
	`tradingStrategyId` int,
	`maxPositions` int DEFAULT 5,
	`maxOrderAmount` decimal(15,2) DEFAULT '1000000',
	`stopLossPct` decimal(5,2) DEFAULT '3.00',
	`takeProfitPct` decimal(5,2) DEFAULT '5.00',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `auto_trader_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auto_trader_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`level` enum('info','warn','error','signal') NOT NULL DEFAULT 'info',
	`message` text NOT NULL,
	`stockCode` varchar(20),
	`strategyId` varchar(50),
	`data` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auto_trader_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kis_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`mode` enum('real','paper') NOT NULL DEFAULT 'paper',
	`encryptedAppKey` text,
	`encryptedAppSecret` text,
	`accountNo` varchar(20),
	`accountProduct` varchar(5) DEFAULT '01',
	`accessToken` text,
	`tokenExpiredAt` timestamp,
	`wsApprovalKey` text,
	`isActive` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kis_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`stockCode` varchar(20) NOT NULL,
	`stockName` varchar(100),
	`orderType` enum('buy','sell') NOT NULL,
	`priceType` enum('market','limit') NOT NULL,
	`quantity` int NOT NULL,
	`price` decimal(15,2),
	`executedPrice` decimal(15,2),
	`executedQty` int DEFAULT 0,
	`status` enum('pending','partial','filled','cancelled','rejected') NOT NULL DEFAULT 'pending',
	`kisOrderNo` varchar(50),
	`strategyId` varchar(50),
	`isAutoOrder` boolean NOT NULL DEFAULT false,
	`errorMsg` text,
	`orderedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `strategy_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`strategyType` enum('selection','trading') NOT NULL,
	`strategyId` varchar(50) NOT NULL,
	`strategyName` varchar(100),
	`isEnabled` boolean NOT NULL DEFAULT false,
	`params` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `strategy_configs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `telegram_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`encryptedBotToken` text,
	`chatId` varchar(50),
	`isEnabled` boolean NOT NULL DEFAULT false,
	`notifyOrder` boolean NOT NULL DEFAULT true,
	`notifySignal` boolean NOT NULL DEFAULT true,
	`notifyError` boolean NOT NULL DEFAULT true,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegram_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`stockCode` varchar(20) NOT NULL,
	`stockName` varchar(100),
	`market` varchar(10) DEFAULT 'J',
	`sortOrder` int NOT NULL DEFAULT 0,
	`isAutoTrading` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `watchlist_id` PRIMARY KEY(`id`)
);
