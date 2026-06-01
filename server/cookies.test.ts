import { describe, expect, it } from "vitest";
import { getSessionCookieOptions } from "./_core/cookies";

describe("session cookie options", () => {
  it("uses browser-accepted SameSite=Lax for plain HTTP tailnet access", () => {
    const options = getSessionCookieOptions({
      protocol: "http",
      headers: {},
    } as any);

    expect(options).toMatchObject({
      httpOnly: true,
      path: "/",
      secure: false,
      sameSite: "lax",
    });
  });

  it("keeps SameSite=None only for HTTPS requests", () => {
    const options = getSessionCookieOptions({
      protocol: "https",
      headers: {},
    } as any);

    expect(options).toMatchObject({
      secure: true,
      sameSite: "none",
    });
  });
});
