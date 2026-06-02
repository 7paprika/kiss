import { describe, expect, it } from "vitest";
import { sanitizeKisApiError } from "./kisApi";

describe("KIS API error redaction", () => {
  it("redacts credentials and request internals from axios-style errors", () => {
    const error = {
      isAxiosError: true,
      message: "Request failed with status code 500",
      response: {
        status: 500,
        data: { rt_cd: "1", msg_cd: "EGW00201", msg1: "초당 거래건수를 초과하였습니다." },
      },
      config: {
        headers: {
          authorization: "Bearer very-secret-token",
          appkey: "very-secret-app-key",
          appsecret: "very-secret-app-secret",
        },
      },
      request: {
        _header: "authorization: Bearer very-secret-token\r\nappkey: very-secret-app-key\r\nappsecret: very-secret-app-secret\r\n",
      },
    };

    const sanitized = sanitizeKisApiError(error);
    const rendered = String(sanitized.stack || sanitized.message || sanitized);

    expect(sanitized.message).toContain("EGW00201");
    expect(sanitized.message).toContain("초당 거래건수를 초과");
    expect(rendered).not.toContain("very-secret-token");
    expect(rendered).not.toContain("very-secret-app-key");
    expect(rendered).not.toContain("very-secret-app-secret");
    expect(rendered).not.toContain("_header");
  });
});
