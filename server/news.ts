import { inflateRawSync } from "node:zlib";

/**
 * 뉴스·공시 모듈
 * - 네이버 뉴스 검색은 k-skill-proxy의 Naver Open API proxy를 우선 사용
 * - 공시는 DART OpenAPI 키(API_K_DART 또는 DART_API_KEY)가 있을 때 공식 DART로 조회
 */

export interface NewsItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
  category: "news" | "disclosure";
}

export interface SourceStatus {
  ok: boolean;
  message: string;
}

export interface NewsResponse {
  items: NewsItem[];
  sourceStatus: {
    news: SourceStatus;
    disclosure: SourceStatus;
  };
}

const DEFAULT_PROXY_BASE = "https://k-skill-proxy.nomadamas.org";
const DART_CORP_CACHE = new Map<string, { corpCode: string; corpName: string }>();

function decodeHtml(input: string): string {
  return input
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
}

function getProxyBase(): string {
  return (process.env.KSKILL_PROXY_BASE_URL || DEFAULT_PROXY_BASE).replace(/\/$/, "");
}

function getDartApiKey(): string | undefined {
  return process.env.API_K_DART || process.env.DART_API_KEY || process.env.DART_API_TOKEN;
}

function toKstDateString(daysAgo = 0): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000 - daysAgo * 24 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * 네이버 금융 종목 뉴스 HTML 파싱 fallback.
 * finance.naver.com은 EUC-KR이라 arrayBuffer + TextDecoder가 필요하다.
 */
export async function fetchStockNews(stockCode: string, limit = 20): Promise<NewsItem[]> {
  try {
    const searchUrl = `https://finance.naver.com/item/news_news.naver?code=${encodeURIComponent(stockCode)}&page=1`;
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Referer": "https://finance.naver.com/",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = new TextDecoder("euc-kr").decode(await res.arrayBuffer());

    const items: NewsItem[] = [];
    const rowRegex = /<td class="title">\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td class="info">([\s\S]*?)<\/td>[\s\S]*?<td class="date">([^<]+)<\/td>/g;
    let m;
    while ((m = rowRegex.exec(html)) !== null && items.length < limit) {
      const rawLink = m[1].startsWith("http") ? m[1] : `https://finance.naver.com${m[1]}`;
      items.push({
        title: decodeHtml(m[2]),
        link: rawLink,
        description: "",
        pubDate: m[4].trim(),
        source: decodeHtml(m[3]) || "네이버금융",
        category: "news",
      });
    }

    return items;
  } catch (err) {
    console.warn("[News] 네이버 금융 종목 뉴스 조회 실패:", err);
    return [];
  }
}

/**
 * 네이버 뉴스 검색 — k-skill-proxy의 Naver Open API proxy를 우선 사용한다.
 */
export async function fetchNewsRSS(stockCode: string, stockName: string, limit = 15): Promise<NewsItem[]> {
  const query = stockName || stockCode;
  try {
    const url = new URL(`${getProxyBase()}/v1/naver-news/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("display", String(Math.max(1, Math.min(limit, 100))));
    url.searchParams.set("sort", "date");

    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
    const json = await res.json() as { items?: Array<Record<string, unknown>> };

    const items = (json.items || []).slice(0, limit).map((item): NewsItem => ({
      title: String(item.title || ""),
      link: String(item.link || item.original_link || ""),
      description: String(item.description || ""),
      pubDate: String(item.pub_date_iso || item.pub_date || ""),
      source: "네이버뉴스",
      category: "news",
    })).filter(item => item.title && item.link);

    if (items.length > 0) return items;
  } catch (err) {
    console.warn("[News] k-skill-proxy 네이버 뉴스 조회 실패, 금융 HTML fallback 시도:", err);
  }

  return fetchStockNews(stockCode, limit);
}

function readUInt16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function readUInt32LE(buf: Uint8Array, offset: number): number {
  return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
}

function extractFirstXmlFromZip(zip: Uint8Array): string {
  let eocdOffset = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (readUInt32LE(zip, i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("DART corpCode ZIP 중앙 디렉터리를 찾지 못했습니다.");

  const entries = readUInt16LE(zip, eocdOffset + 10);
  let centralOffset = readUInt32LE(zip, eocdOffset + 16);

  for (let i = 0; i < entries && centralOffset + 46 < zip.length; i++) {
    if (readUInt32LE(zip, centralOffset) !== 0x02014b50) break;
    const method = readUInt16LE(zip, centralOffset + 10);
    const compressedSize = readUInt32LE(zip, centralOffset + 20);
    const fileNameLength = readUInt16LE(zip, centralOffset + 28);
    const extraLength = readUInt16LE(zip, centralOffset + 30);
    const commentLength = readUInt16LE(zip, centralOffset + 32);
    const localOffset = readUInt32LE(zip, centralOffset + 42);
    const nameStart = centralOffset + 46;
    const nameEnd = nameStart + fileNameLength;
    const name = new TextDecoder().decode(zip.slice(nameStart, nameEnd));

    if (name.toLowerCase().endsWith(".xml")) {
      if (readUInt32LE(zip, localOffset) !== 0x04034b50) {
        throw new Error("DART corpCode ZIP 로컬 헤더가 올바르지 않습니다.");
      }
      const localNameLength = readUInt16LE(zip, localOffset + 26);
      const localExtraLength = readUInt16LE(zip, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      const data = zip.slice(dataStart, dataEnd);
      if (method === 0) return new TextDecoder("utf8").decode(data);
      if (method === 8) return inflateRawSync(data).toString("utf8");
      throw new Error(`지원하지 않는 ZIP 압축 방식: ${method}`);
    }

    centralOffset = nameEnd + extraLength + commentLength;
  }

  throw new Error("DART corpCode ZIP에서 XML 파일을 찾지 못했습니다.");
}

async function findDartCorpCode(stockCode: string, stockName: string, apiKey: string): Promise<{ corpCode: string; corpName: string } | null> {
  const cached = DART_CORP_CACHE.get(stockCode);
  if (cached) return cached;

  const url = new URL("https://opendart.fss.or.kr/api/corpCode.xml");
  url.searchParams.set("crtfc_key", apiKey);
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`DART corpCode HTTP ${res.status}`);

  const zipped = new Uint8Array(await res.arrayBuffer());
  const xml = extractFirstXmlFromZip(zipped);
  const rowRegex = /<list>[\s\S]*?<corp_code>([^<]+)<\/corp_code>[\s\S]*?<corp_name>([^<]+)<\/corp_name>[\s\S]*?<stock_code>([^<]*)<\/stock_code>[\s\S]*?<\/list>/g;
  let m;
  while ((m = rowRegex.exec(xml)) !== null) {
    const corpCode = m[1].trim();
    const corpName = m[2].trim();
    const listedCode = m[3].trim();
    if (listedCode === stockCode || (!!stockName && corpName === stockName)) {
      const found = { corpCode, corpName };
      DART_CORP_CACHE.set(stockCode, found);
      return found;
    }
  }
  return null;
}

export async function fetchKindDisclosures(stockCode: string, limit = 10, stockName = ""): Promise<NewsItem[]> {
  const apiKey = getDartApiKey();
  if (!apiKey) return [];

  try {
    const corp = await findDartCorpCode(stockCode, stockName, apiKey);
    if (!corp) throw new Error(`DART corp_code not found for ${stockCode}`);

    const url = new URL("https://opendart.fss.or.kr/api/list.json");
    url.searchParams.set("crtfc_key", apiKey);
    url.searchParams.set("corp_code", corp.corpCode);
    url.searchParams.set("bgn_de", toKstDateString(120));
    url.searchParams.set("end_de", toKstDateString(0));
    url.searchParams.set("sort", "date");
    url.searchParams.set("sort_mth", "desc");
    url.searchParams.set("page_count", String(Math.max(1, Math.min(limit, 100))));

    const res = await fetch(url, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`DART list HTTP ${res.status}`);
    const json = await res.json() as { status?: string; message?: string; list?: Array<Record<string, unknown>> };

    if (json.status === "013") return [];
    if (json.status && json.status !== "000") throw new Error(`DART ${json.status}: ${json.message || "조회 실패"}`);

    return (json.list || []).slice(0, limit).map((item): NewsItem => ({
      title: String(item.report_nm || ""),
      link: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(String(item.rcept_no || ""))}`,
      description: String(item.corp_name || corp.corpName || ""),
      pubDate: String(item.rcept_dt || ""),
      source: "DART공시",
      category: "disclosure",
    })).filter(item => item.title && item.link);
  } catch (err) {
    console.warn("[News] DART 공시 조회 실패:", err);
    return [];
  }
}

async function withStatus<T>(fn: () => Promise<T[]>, unavailableMessage?: string): Promise<{ items: T[]; status: SourceStatus }> {
  if (unavailableMessage) {
    return { items: [], status: { ok: false, message: unavailableMessage } };
  }
  try {
    const items = await fn();
    return { items, status: { ok: true, message: items.length > 0 ? "정상 조회" : "조회 결과 없음" } };
  } catch (err) {
    return { items: [], status: { ok: false, message: err instanceof Error ? err.message : "조회 실패" } };
  }
}

/**
 * 종목 뉴스 + 공시 통합 조회
 */
export async function fetchStockNewsAndDisclosures(
  stockCode: string,
  stockName: string,
  limit = 20
): Promise<NewsResponse> {
  const disclosureUnavailable = getDartApiKey()
    ? undefined
    : "DART API 키(API_K_DART 또는 DART_API_KEY)가 없어 공시를 조회할 수 없습니다.";

  const [news, disclosures] = await Promise.all([
    withStatus(() => fetchNewsRSS(stockCode, stockName, Math.ceil(limit * 0.7))),
    withStatus(() => fetchKindDisclosures(stockCode, Math.ceil(limit * 0.3), stockName), disclosureUnavailable),
  ]);

  const combined = [...news.items, ...disclosures.items];
  combined.sort((a, b) => {
    const da = new Date(a.pubDate).getTime() || Number(String(a.pubDate).replace(/\D/g, "")) || 0;
    const db = new Date(b.pubDate).getTime() || Number(String(b.pubDate).replace(/\D/g, "")) || 0;
    return db - da;
  });

  return {
    items: combined.slice(0, limit),
    sourceStatus: {
      news: news.status,
      disclosure: disclosures.status,
    },
  };
}
