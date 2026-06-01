export const AUTO_TRADE_MARKET_CRON_UTC = "0 */5 0-6 * * 1-5";

export function getKstParts(date: Date): {
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    day: dayMap[get("weekday")] ?? -1,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export function isKoreanMarketHours(date = new Date()): boolean {
  const { day, hour, minute } = getKstParts(date);
  if (day < 1 || day > 5) return false;
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}
