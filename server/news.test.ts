import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;
const originalEnv = process.env;

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
});
