export interface StockSearchItem {
  code: string;
  name: string;
  market: string;
}

const KRX_LISTED_COMPANIES_URL = "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13";
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const HANGUL_INITIALS = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

const FALLBACK_STOCKS: StockSearchItem[] = [
  { code: "005930", name: "삼성전자", market: "KRX" },
  { code: "000660", name: "SK하이닉스", market: "KRX" },
  { code: "373220", name: "LG에너지솔루션", market: "KRX" },
  { code: "207940", name: "삼성바이오로직스", market: "KRX" },
  { code: "005380", name: "현대차", market: "KRX" },
  { code: "000270", name: "기아", market: "KRX" },
  { code: "068270", name: "셀트리온", market: "KRX" },
  { code: "035420", name: "NAVER", market: "KRX" },
  { code: "035720", name: "카카오", market: "KRX" },
  { code: "005490", name: "POSCO홀딩스", market: "KRX" },
  { code: "105560", name: "KB금융", market: "KRX" },
  { code: "055550", name: "신한지주", market: "KRX" },
  { code: "012330", name: "현대모비스", market: "KRX" },
  { code: "028260", name: "삼성물산", market: "KRX" },
  { code: "096770", name: "SK이노베이션", market: "KRX" },
];

let cachedStocks: StockSearchItem[] | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function normalizeStockQuery(value: string): string {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

export function getHangulInitials(value: string): string {
  return Array.from(value).map((char) => {
    const code = char.charCodeAt(0);
    if (code < HANGUL_BASE || code > HANGUL_LAST) return char;
    const initialIndex = Math.floor((code - HANGUL_BASE) / (21 * 28));
    return HANGUL_INITIALS[initialIndex] || char;
  }).join("");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, "").trim());
}

export function parseKrxListedCompaniesHtml(html: string): StockSearchItem[] {
  const rows = Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));
  const stocks: StockSearchItem[] = [];

  for (const row of rows) {
    const cells = Array.from(row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((cell) => stripHtml(cell[1]));
    if (cells.length < 2 || cells[0] === "회사명" || cells[1] === "종목코드") continue;

    const name = cells[0];
    const market = cells[1] || "KRX";
    const code = (cells[2] || "").replace(/\D/g, "").padStart(6, "0");
    if (!name || !/^\d{6}$/.test(code)) continue;
    stocks.push({ code, name, market });
  }

  return stocks;
}

export function searchLocalStocks(keyword: string, stocks: StockSearchItem[], limit = 20): StockSearchItem[] {
  const query = normalizeStockQuery(keyword);
  if (!query) return [];

  const scored = stocks
    .map((stock) => {
      const code = stock.code.toLowerCase();
      const name = normalizeStockQuery(stock.name);
      const initials = normalizeStockQuery(getHangulInitials(stock.name));
      const market = normalizeStockQuery(stock.market);

      let score = Number.POSITIVE_INFINITY;
      if (code === query) score = 0;
      else if (code.startsWith(query)) score = 1;
      else if (name === query) score = 2;
      else if (name.startsWith(query)) score = 3;
      else if (initials === query) score = 4;
      else if (initials.startsWith(query)) score = 5;
      else if (name.includes(query)) score = 6;
      else if (initials.includes(query)) score = 7;
      else if (market.includes(query)) score = 8;

      return { stock, score };
    })
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score || a.stock.name.localeCompare(b.stock.name, "ko") || a.stock.code.localeCompare(b.stock.code));

  const seen = new Set<string>();
  const results: StockSearchItem[] = [];
  for (const item of scored) {
    if (seen.has(item.stock.code)) continue;
    seen.add(item.stock.code);
    results.push(item.stock);
    if (results.length >= limit) break;
  }
  return results;
}

export async function loadKrxStocks(): Promise<StockSearchItem[]> {
  const now = Date.now();
  if (cachedStocks && now - cachedAt < CACHE_TTL_MS) return cachedStocks;

  try {
    const response = await fetch(KRX_LISTED_COMPANIES_URL, {
      headers: { "User-Agent": "Mozilla/5.0 KIS-Auto-Trader" },
    });
    if (!response.ok) throw new Error(`KRX list request failed: ${response.status}`);
    const buffer = await response.arrayBuffer();
    const html = new TextDecoder("euc-kr").decode(buffer);
    const parsed = parseKrxListedCompaniesHtml(html);
    if (parsed.length > 100) {
      cachedStocks = parsed;
      cachedAt = now;
      return parsed;
    }
  } catch (error) {
    console.warn("[StockSearch] KRX listed-company lookup failed; using fallback seeds", error);
  }

  cachedStocks = FALLBACK_STOCKS;
  cachedAt = now;
  return FALLBACK_STOCKS;
}

export async function searchStocks(keyword: string, limit = 20): Promise<StockSearchItem[]> {
  const stocks = await loadKrxStocks();
  return searchLocalStocks(keyword, stocks, limit);
}
