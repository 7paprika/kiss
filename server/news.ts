/**
 * 뉴스·공시 모듈
 * - 네이버 금융 종목 뉴스 RSS 파싱
 * - KRX 공시 정보 (KIND API)
 */

interface NewsItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
  category: "news" | "disclosure";
}

/**
 * 네이버 금융 종목 뉴스 RSS 파싱
 * URL: https://finance.naver.com/item/news_news.naver?code=XXXXXX&page=1&sm=title_entity_id.basic&clusterId=
 * RSS: https://finance.naver.com/news/news_search.naver?rcdate=&q=XXXXXX&x=0&y=0&sm=top_sise&field=0&sort=0&pd=0&ds=&de=
 */
export async function fetchStockNews(stockCode: string, limit = 20): Promise<NewsItem[]> {
  try {
    // 네이버 금융 뉴스 검색 (종목명 검색 방식)
    const searchUrl = `https://finance.naver.com/item/news_news.naver?code=${stockCode}&page=1`;
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
    const html = await res.text();

    // HTML 파싱으로 뉴스 추출
    const items: NewsItem[] = [];

    // 뉴스 테이블 행 추출 (td.title > a)
    const rowRegex = /<td class="title">\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    const dateRegex = /<td class="date">([^<]+)<\/td>/g;
    const sourceRegex = /<td class="info">([^<]+)<\/td>/g;

    const titles: string[] = [];
    const links: string[] = [];
    const dates: string[] = [];
    const sources: string[] = [];

    let m;
    while ((m = rowRegex.exec(html)) !== null) {
      links.push(`https://finance.naver.com${m[1]}`);
      titles.push(m[2].trim());
    }
    while ((m = dateRegex.exec(html)) !== null) {
      dates.push(m[1].trim());
    }
    while ((m = sourceRegex.exec(html)) !== null) {
      sources.push(m[1].trim());
    }

    for (let i = 0; i < Math.min(titles.length, limit); i++) {
      items.push({
        title: titles[i] || "",
        link: links[i] || "",
        description: "",
        pubDate: dates[i] || "",
        source: sources[i] || "네이버금융",
        category: "news",
      });
    }

    return items;
  } catch (err) {
    console.warn("[News] 네이버 금융 뉴스 조회 실패:", err);
    return [];
  }
}

/**
 * 네이버 금융 RSS 뉴스 (키워드 기반)
 * RSS URL: https://finance.naver.com/news/news_search.naver?rcdate=&q=KEYWORD
 */
export async function fetchNewsRSS(stockCode: string, stockName: string, limit = 15): Promise<NewsItem[]> {
  try {
    // 네이버 뉴스 RSS - 종목명으로 검색
    const query = encodeURIComponent(stockName || stockCode);
    const rssUrl = `https://finance.naver.com/news/news_search.naver?rcdate=&q=${query}&x=0&y=0&sm=top_sise&field=0&sort=0&pd=0&ds=&de=`;

    const res = await fetch(rssUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KISAutoTrader/1.0)",
        "Accept": "text/html",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const items: NewsItem[] = [];

    // 뉴스 리스트 파싱
    const articleRegex = /<dt[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<\/dt>[\s\S]*?<dd[^>]*>([^<]*)<\/dd>[\s\S]*?<dd[^>]*class="[^"]*date[^"]*"[^>]*>([^<]+)<\/dd>/g;
    let m;
    while ((m = articleRegex.exec(html)) !== null && items.length < limit) {
      const rawLink = m[1];
      const link = rawLink.startsWith("http") ? rawLink : `https://finance.naver.com${rawLink}`;
      items.push({
        title: m[2].trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#[0-9]+;/g, ""),
        link,
        description: m[3].trim().replace(/<[^>]+>/g, ""),
        pubDate: m[4].trim(),
        source: "네이버금융",
        category: "news",
      });
    }

    return items;
  } catch (err) {
    console.warn("[News] RSS 뉴스 조회 실패:", err);
    return [];
  }
}

/**
 * KIND(한국거래소 공시) 종목 공시 조회
 * https://kind.krx.co.kr/disclosure/todaydisclosure.do
 */
export async function fetchKindDisclosures(stockCode: string, limit = 10): Promise<NewsItem[]> {
  try {
    const url = `https://kind.krx.co.kr/disclosure/companysearch.do?method=searchTotalInfoMain&searchCodeType=&searchCorpName=&searchCorpCode=${stockCode}&repIsuSrtCd=${stockCode}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KISAutoTrader/1.0)",
        "Accept": "application/json, text/html",
        "Referer": "https://kind.krx.co.kr/",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    const items: NewsItem[] = [];

    // JSON 응답 파싱 시도
    try {
      const json = JSON.parse(text);
      const list = json?.result?.list || json?.list || [];
      for (const item of list.slice(0, limit)) {
        items.push({
          title: item.rptNm || item.title || "",
          link: `https://kind.krx.co.kr/disclosure/disclosuredetail.do?method=searchDisclosureDetail&acptNo=${item.acptNo}`,
          description: item.corpNm || "",
          pubDate: item.acptDt || item.date || "",
          source: "KIND공시",
          category: "disclosure",
        });
      }
    } catch {
      // HTML 파싱 fallback
      const rowRegex = /<tr[^>]*>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*><a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a><\/td>/g;
      let m;
      while ((m = rowRegex.exec(text)) !== null && items.length < limit) {
        items.push({
          title: m[3].trim(),
          link: m[2].startsWith("http") ? m[2] : `https://kind.krx.co.kr${m[2]}`,
          description: "",
          pubDate: m[1].trim(),
          source: "KIND공시",
          category: "disclosure",
        });
      }
    }

    return items;
  } catch (err) {
    console.warn("[News] KIND 공시 조회 실패:", err);
    return [];
  }
}

/**
 * 종목 뉴스 + 공시 통합 조회
 */
export async function fetchStockNewsAndDisclosures(
  stockCode: string,
  stockName: string,
  limit = 20
): Promise<NewsItem[]> {
  const [news, disclosures] = await Promise.allSettled([
    fetchNewsRSS(stockCode, stockName, Math.ceil(limit * 0.7)),
    fetchKindDisclosures(stockCode, Math.ceil(limit * 0.3)),
  ]);

  const newsItems = news.status === "fulfilled" ? news.value : [];
  const disclosureItems = disclosures.status === "fulfilled" ? disclosures.value : [];

  // 날짜 기준 정렬 (최신순)
  const combined = [...newsItems, ...disclosureItems];
  combined.sort((a, b) => {
    const da = new Date(a.pubDate).getTime() || 0;
    const db = new Date(b.pubDate).getTime() || 0;
    return db - da;
  });

  return combined.slice(0, limit);
}
