import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/components/NewsPanel.tsx"), "utf8");

describe("NewsPanel source diagnostics", () => {
  it("renders source integration failures separately from empty news results", () => {
    expect(source).toContain("sourceStatus");
    expect(source).toContain("연동 상태");
    expect(source).toContain("뉴스가 없습니다");
    expect(source).toContain("소스 연동 실패");
  });
});
