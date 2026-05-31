ALTER TABLE `kis_settings` ADD `profileName` varchar(100) DEFAULT '기본 계좌';--> statement-breakpoint
ALTER TABLE `kis_settings` ADD `isDefault` boolean DEFAULT false NOT NULL;