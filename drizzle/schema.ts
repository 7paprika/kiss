import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  boolean,
  json,
  decimal,
  bigint,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// KIS API 설정 (암호화된 appkey/appsecret 저장) - 다중 계좌 지원
export const kisSettings = mysqlTable("kis_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  profileName: varchar("profileName", { length: 100 }).default("기본 계좌"), // 계좌 프로필 이름
  mode: mysqlEnum("mode", ["real", "paper"]).default("paper").notNull(), // 실전/모의
  encryptedAppKey: text("encryptedAppKey"),
  encryptedAppSecret: text("encryptedAppSecret"),
  accountNo: varchar("accountNo", { length: 20 }), // 계좌번호 앞 8자리
  accountProduct: varchar("accountProduct", { length: 5 }).default("01"), // 계좌 뒤 2자리
  accessToken: text("accessToken"),
  tokenExpiredAt: timestamp("tokenExpiredAt"),
  wsApprovalKey: text("wsApprovalKey"),
  isActive: boolean("isActive").default(false).notNull(), // 이 계좌가 현재 선택된 계좌
  isDefault: boolean("isDefault").default(false).notNull(), // 기본 계좌
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type KisSettings = typeof kisSettings.$inferSelect;

// 관심종목
export const watchlist = mysqlTable("watchlist", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  stockCode: varchar("stockCode", { length: 20 }).notNull(),
  stockName: varchar("stockName", { length: 100 }),
  market: varchar("market", { length: 10 }).default("J"), // J=주식, ETF 등
  sortOrder: int("sortOrder").default(0).notNull(),
  isAutoTrading: boolean("isAutoTrading").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Watchlist = typeof watchlist.$inferSelect;

// 전략 설정 (선정 전략 / 매매 전략 분리)
export const strategyConfigs = mysqlTable("strategy_configs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  strategyType: mysqlEnum("strategyType", ["selection", "trading"]).notNull(),
  strategyId: varchar("strategyId", { length: 50 }).notNull(), // e.g. "momentum", "bollinger"
  strategyName: varchar("strategyName", { length: 100 }),
  isEnabled: boolean("isEnabled").default(false).notNull(),
  params: json("params"), // 전략별 파라미터 JSON
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type StrategyConfig = typeof strategyConfigs.$inferSelect;

// 자동매매 조합 설정 (선정 전략 + 매매 전략 매핑)
export const autoTraderConfig = mysqlTable("auto_trader_config", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  isRunning: boolean("isRunning").default(false).notNull(),
  selectionStrategyId: int("selectionStrategyId"), // FK -> strategyConfigs
  tradingStrategyId: int("tradingStrategyId"),     // FK -> strategyConfigs
  maxPositions: int("maxPositions").default(5),    // 최대 보유 종목 수
  maxOrderAmount: decimal("maxOrderAmount", { precision: 15, scale: 2 }).default("1000000"), // 종목당 최대 주문금액
  stopLossPct: decimal("stopLossPct", { precision: 5, scale: 2 }).default("3.00"),   // 손절 %
  takeProfitPct: decimal("takeProfitPct", { precision: 5, scale: 2 }).default("5.00"), // 익절 %
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }), // Heartbeat task UID
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AutoTraderConfig = typeof autoTraderConfig.$inferSelect;

// 주문 내역
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  stockCode: varchar("stockCode", { length: 20 }).notNull(),
  stockName: varchar("stockName", { length: 100 }),
  orderType: mysqlEnum("orderType", ["buy", "sell"]).notNull(),
  priceType: mysqlEnum("priceType", ["market", "limit"]).notNull(),
  quantity: int("quantity").notNull(),
  price: decimal("price", { precision: 15, scale: 2 }),
  executedPrice: decimal("executedPrice", { precision: 15, scale: 2 }),
  executedQty: int("executedQty").default(0),
  status: mysqlEnum("status", ["pending", "partial", "filled", "cancelled", "rejected"]).default("pending").notNull(),
  kisOrderNo: varchar("kisOrderNo", { length: 50 }), // KIS 주문번호
  strategyId: varchar("strategyId", { length: 50 }), // 어떤 전략에서 발생한 주문인지
  isAutoOrder: boolean("isAutoOrder").default(false).notNull(),
  errorMsg: text("errorMsg"),
  orderedAt: timestamp("orderedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Order = typeof orders.$inferSelect;

// 자동매매 로그
export const autoTraderLogs = mysqlTable("auto_trader_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  level: mysqlEnum("level", ["info", "warn", "error", "signal"]).default("info").notNull(),
  message: text("message").notNull(),
  stockCode: varchar("stockCode", { length: 20 }),
  strategyId: varchar("strategyId", { length: 50 }),
  data: json("data"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AutoTraderLog = typeof autoTraderLogs.$inferSelect;

// 텔레그램 설정
export const telegramSettings = mysqlTable("telegram_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  encryptedBotToken: text("encryptedBotToken"),
  chatId: varchar("chatId", { length: 50 }),
  isEnabled: boolean("isEnabled").default(false).notNull(),
  notifyOrder: boolean("notifyOrder").default(true).notNull(),
  notifySignal: boolean("notifySignal").default(true).notNull(),
  notifyError: boolean("notifyError").default(true).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TelegramSettings = typeof telegramSettings.$inferSelect;

// 종목 스크리너 결과 (자동매매 사이클에서 선정된 종목 저장)
export const screenerResults = mysqlTable("screener_results", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  runDate: varchar("runDate", { length: 10 }).notNull(), // YYYY-MM-DD
  stockCode: varchar("stockCode", { length: 20 }).notNull(),
  stockName: varchar("stockName", { length: 100 }),
  strategyId: varchar("strategyId", { length: 50 }).notNull(),
  strategyName: varchar("strategyName", { length: 100 }),
  signal: mysqlEnum("signal", ["BUY", "SELL", "HOLD"]).notNull(),
  strength: decimal("strength", { precision: 5, scale: 4 }).default("0"), // 0~1
  reason: text("reason"),
  priceAtScan: decimal("priceAtScan", { precision: 15, scale: 2 }),
  addedToWatchlist: boolean("addedToWatchlist").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ScreenerResult = typeof screenerResults.$inferSelect;

// 백테스트 결과 저장 (다중 전략 비교용)
export const backtestResults = mysqlTable("backtest_results", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  batchId: varchar("batchId", { length: 36 }), // UUID - 비교 그룹
  stockCode: varchar("stockCode", { length: 20 }).notNull(),
  strategyId: varchar("strategyId", { length: 50 }).notNull(),
  strategyName: varchar("strategyName", { length: 100 }),
  period: varchar("period", { length: 10 }).default("D"),
  initialCapital: decimal("initialCapital", { precision: 15, scale: 2 }),
  finalCapital: decimal("finalCapital", { precision: 15, scale: 2 }),
  totalReturn: decimal("totalReturn", { precision: 10, scale: 4 }),
  annualizedReturn: decimal("annualizedReturn", { precision: 10, scale: 4 }),
  maxDrawdown: decimal("maxDrawdown", { precision: 10, scale: 4 }),
  sharpeRatio: decimal("sharpeRatio", { precision: 10, scale: 4 }),
  winRate: decimal("winRate", { precision: 10, scale: 4 }),
  totalTrades: int("totalTrades").default(0),
  winTrades: int("winTrades").default(0),
  lossTrades: int("lossTrades").default(0),
  stopLossPct: decimal("stopLossPct", { precision: 5, scale: 2 }).default("0"),
  takeProfitPct: decimal("takeProfitPct", { precision: 5, scale: 2 }).default("0"),
  resultJson: json("resultJson"), // 전체 BacktestResult JSON
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BacktestResult = typeof backtestResults.$inferSelect;
