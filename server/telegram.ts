/**
 * Telegram Bot Notification Module
 */

import axios from "axios";
import { getDb } from "./db";
import { telegramSettings } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "./crypto";

export type TelegramNotifyType = "order" | "signal" | "error" | "info";

async function getTelegramConfig(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(telegramSettings).where(eq(telegramSettings.userId, userId)).limit(1);
  if (!rows.length || !rows[0].isEnabled) return null;
  const row = rows[0];
  const botToken = decrypt(row.encryptedBotToken || "");
  if (!botToken || !row.chatId) return null;
  return { botToken, chatId: row.chatId, notifyOrder: row.notifyOrder, notifySignal: row.notifySignal, notifyError: row.notifyError };
}

export async function sendTelegramMessage(
  userId: number,
  type: TelegramNotifyType,
  message: string
): Promise<boolean> {
  try {
    const config = await getTelegramConfig(userId);
    if (!config) return false;

    // Check notification type filter
    if (type === "order" && !config.notifyOrder) return false;
    if (type === "signal" && !config.notifySignal) return false;
    if (type === "error" && !config.notifyError) return false;

    const emoji = { order: "📋", signal: "🔔", error: "🚨", info: "ℹ️" }[type];
    const text = `${emoji} *KIS Auto Trader*\n\n${message}\n\n_${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}_`;

    await axios.post(
      `https://api.telegram.org/bot${config.botToken}/sendMessage`,
      { chat_id: config.chatId, text, parse_mode: "Markdown" },
      { timeout: 5000 }
    );
    return true;
  } catch (err) {
    console.error("[Telegram] Failed to send message:", err);
    return false;
  }
}

export async function testTelegramConnection(botToken: string, chatId: string): Promise<{ success: boolean; message: string }> {
  try {
    const text = "✅ *KIS Auto Trader 텔레그램 연결 테스트 성공*\n\n알림 설정이 완료되었습니다.";
    await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      { chat_id: chatId, text, parse_mode: "Markdown" },
      { timeout: 5000 }
    );
    return { success: true, message: "텔레그램 연결 성공" };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message: `연결 실패: ${message}` };
  }
}
