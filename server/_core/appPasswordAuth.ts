import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { ENV } from "./env";

const scrypt = promisify(scryptCallback);
const HASH_PREFIX = "scrypt";

export type PasswordLoginResult =
  | { ok: true; passwordHash: string; mustChangePassword: boolean }
  | { ok: false; reason: "INVALID_PASSWORD" | "PASSWORD_CHANGE_REQUIRED" | "NEW_PASSWORD_TOO_SHORT" | "PASSWORD_NOT_CONFIGURED" };

export type PasswordAuthState = {
  passwordHash: string;
  mustChangePassword: boolean;
  updatedAt: string;
};

export async function createPasswordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${HASH_PREFIX}$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [prefix, salt, expectedHex] = storedHash.split("$");
  if (prefix !== HASH_PREFIX || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export async function evaluatePasswordLogin(input: {
  password: string;
  newPassword?: string | null;
  passwordHash: string;
  mustChangePassword: boolean;
}): Promise<PasswordLoginResult> {
  if (!input.passwordHash) return { ok: false, reason: "PASSWORD_NOT_CONFIGURED" };

  const valid = await verifyPassword(input.password, input.passwordHash);
  if (!valid) return { ok: false, reason: "INVALID_PASSWORD" };

  if (input.mustChangePassword) {
    const newPassword = input.newPassword?.trim() ?? "";
    if (!newPassword) return { ok: false, reason: "PASSWORD_CHANGE_REQUIRED" };
    if (newPassword.length < 10) return { ok: false, reason: "NEW_PASSWORD_TOO_SHORT" };
    return {
      ok: true,
      passwordHash: await createPasswordHash(newPassword),
      mustChangePassword: false,
    };
  }

  return { ok: true, passwordHash: input.passwordHash, mustChangePassword: false };
}

export async function loadPasswordAuthState(): Promise<PasswordAuthState> {
  try {
    const raw = await readFile(ENV.appPasswordStatePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PasswordAuthState>;
    if (parsed.passwordHash) {
      return {
        passwordHash: parsed.passwordHash,
        mustChangePassword: Boolean(parsed.mustChangePassword),
        updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      };
    }
  } catch {
    // Fall back to env-defined initial credentials.
  }

  return {
    passwordHash: ENV.appPasswordHash,
    mustChangePassword: ENV.appPasswordMustChange,
    updatedAt: new Date(0).toISOString(),
  };
}

export async function savePasswordAuthState(state: Omit<PasswordAuthState, "updatedAt">): Promise<PasswordAuthState> {
  const next: PasswordAuthState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(ENV.appPasswordStatePath), { recursive: true });
  await writeFile(ENV.appPasswordStatePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}
