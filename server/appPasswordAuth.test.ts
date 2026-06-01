import { describe, expect, it } from "vitest";
import {
  createPasswordHash,
  evaluatePasswordLogin,
  verifyPassword,
} from "./_core/appPasswordAuth";

describe("app password auth", () => {
  it("verifies only the matching password against a stored hash", async () => {
    const hash = await createPasswordHash("initial-secret");

    await expect(verifyPassword("initial-secret", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-secret", hash)).resolves.toBe(false);
  });

  it("requires a new password on first login when mustChange is enabled", async () => {
    const hash = await createPasswordHash("initial-secret");

    await expect(
      evaluatePasswordLogin({
        password: "initial-secret",
        passwordHash: hash,
        mustChangePassword: true,
      })
    ).resolves.toEqual({ ok: false, reason: "PASSWORD_CHANGE_REQUIRED" });
  });

  it("accepts first login when a valid replacement password is supplied", async () => {
    const hash = await createPasswordHash("initial-secret");

    const result = await evaluatePasswordLogin({
      password: "initial-secret",
      newPassword: "changed-secret-123",
      passwordHash: hash,
      mustChangePassword: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mustChangePassword).toBe(false);
      await expect(verifyPassword("changed-secret-123", result.passwordHash)).resolves.toBe(true);
      await expect(verifyPassword("initial-secret", result.passwordHash)).resolves.toBe(false);
    }
  });
});
