import { describe, expect, it } from "vitest";
import { getHangulInitials, searchLocalStocks } from "./stockSearch";

const stocks = [
  { code: "005930", name: "삼성전자", market: "KOSPI" },
  { code: "000660", name: "SK하이닉스", market: "KOSPI" },
  { code: "035420", name: "NAVER", market: "KOSPI" },
  { code: "035720", name: "카카오", market: "KOSPI" },
];

describe("stock search", () => {
  it("parses KRX listed-company HTML with market and zero-padded stock code columns", async () => {
    const { parseKrxListedCompaniesHtml } = await import("./stockSearch");
    const html = `<table><tr><th>회사명</th><th>시장구분</th><th>종목코드</th></tr><tr><td>삼성전자</td><td>유가</td><td style="mso-number-format:'@';text-align:center;">005930</td></tr></table>`;

    expect(parseKrxListedCompaniesHtml(html)).toEqual([
      { code: "005930", name: "삼성전자", market: "유가" },
    ]);
  });

  it("builds Korean initial consonants for stock names", () => {
    expect(getHangulInitials("삼성전자")).toBe("ㅅㅅㅈㅈ");
    expect(getHangulInitials("SK하이닉스")).toBe("SKㅎㅇㄴㅅ");
  });

  it("matches stocks by code, Korean name, English name, and Korean initials", () => {
    expect(searchLocalStocks("005930", stocks).map((s) => s.code)).toEqual(["005930"]);
    expect(searchLocalStocks("삼성", stocks).map((s) => s.code)).toEqual(["005930"]);
    expect(searchLocalStocks("nav", stocks).map((s) => s.code)).toEqual(["035420"]);
    expect(searchLocalStocks("ㅅㅅㅈ", stocks).map((s) => s.code)).toEqual(["005930"]);
    expect(searchLocalStocks("ㅎㅇㄴ", stocks).map((s) => s.code)).toEqual(["000660"]);
  });
});
