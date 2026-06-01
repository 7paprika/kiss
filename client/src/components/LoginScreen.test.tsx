import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import LoginScreen from "./LoginScreen";

describe("LoginScreen", () => {
  it("renders an app-password login form", () => {
    const html = renderToStaticMarkup(
      <LoginScreen
        mustChangePassword={false}
        loginError={null}
        onSubmit={vi.fn()}
      />
    );

    expect(html).toContain("KIS Auto Trader");
    expect(html).toContain("앱 비밀번호");
    expect(html).toContain("로그인");
    expect(html).not.toContain("href=");
  });

  it("asks for a new password when initial password must be changed", () => {
    const html = renderToStaticMarkup(
      <LoginScreen
        mustChangePassword
        loginError={null}
        onSubmit={vi.fn()}
      />
    );

    expect(html).toContain("최초 로그인");
    expect(html).toContain("새 비밀번호");
  });
});
