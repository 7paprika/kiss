import { deflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;
const originalEnv = process.env;

function makeZipWithXml(xml: string): BodyInit {
  const name = Buffer.from("CORPCODE.xml");
  const data = deflateRawSync(Buffer.from(xml, "utf8"));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 10);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(Buffer.byteLength(xml), 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 12);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(Buffer.byteLength(xml), 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt32LE(0, 42);

  const localPart = Buffer.concat([local, name, data]);
  const centralPart = Buffer.concat([central, name]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, centralPart, eocd]);
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe("news/disclosure integration", () => {
  it("uses the k-skill-proxy Naver News API and normalizes results", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: URL | RequestInfo) => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        items: [
          {
            title: "삼성전자 실적 개선",
            description: "기사 요약",
            link: "https://n.news.naver.com/article/1",
            original_link: "https://example.com/a",
            pub_date: "Tue, 02 Jun 2026 16:22:00 +0900",
            pub_date_iso: "2026-06-02T07:22:00.000Z",
            source: "naver-openapi",
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const { fetchNewsRSS } = await import("./news");
    const items = await fetchNewsRSS("005930", "삼성전자", 5);

    expect(calls[0]).toContain("/v1/naver-news/search");
    expect(calls[0]).toContain("sort=date");
    expect(items).toEqual([
      expect.objectContaining({
        title: "삼성전자 실적 개선",
        description: "기사 요약",
        link: "https://n.news.naver.com/article/1",
        pubDate: "2026-06-02T07:22:00.000Z",
        source: "네이버뉴스",
        category: "news",
      }),
    ]);
  });

  it("returns source diagnostics so the UI can distinguish disclosure integration failure from an empty list", async () => {
    delete process.env.API_K_DART;
    delete process.env.DART_API_KEY;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })) as typeof fetch;

    const { fetchStockNewsAndDisclosures } = await import("./news");
    const result = await fetchStockNewsAndDisclosures("005930", "삼성전자", 10);

    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("sourceStatus.disclosure.ok", false);
    expect(result.sourceStatus.disclosure.message).toContain("DART API 키");
    expect(result.sourceStatus.news.ok).toBe(true);
  });

  it("parses DART corpCode XML with corp_eng_name between corp_name and stock_code", async () => {
    process.env.API_K_DART = "test-key";
    const corpXml = `<?xml version="1.0" encoding="UTF-8"?>
<result>
  <list>
    <corp_code>00126380</corp_code>
    <corp_name>삼성전자</corp_name>
    <corp_eng_name>SAMSUNG ELECTRONICS CO,.LTD</corp_eng_name>
    <stock_code>005930</stock_code>
    <modify_date>20251201</modify_date>
  </list>
</result>`;

    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: URL | RequestInfo) => {
      const href = String(url);
      calls.push(href);
      if (href.includes("corpCode.xml")) {
        return new Response(makeZipWithXml(corpXml), { status: 200 });
      }
      return new Response(JSON.stringify({
        status: "000",
        message: "정상",
        list: [
          {
            corp_name: "삼성전자",
            report_nm: "사업보고서",
            rcept_no: "20260602000001",
            rcept_dt: "20260602",
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const { fetchKindDisclosures } = await import("./news");
    const items = await fetchKindDisclosures("005930", 3, "삼성전자");

    expect(calls.some(call => call.includes("corpCode.xml"))).toBe(true);
    expect(calls.some(call => call.includes("list.json") && call.includes("corp_code=00126380"))).toBe(true);
    expect(items).toEqual([
      expect.objectContaining({
        title: "사업보고서",
        source: "DART공시",
        category: "disclosure",
        pubDate: "20260602",
      }),
    ]);
  });
});
