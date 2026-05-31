import CryptoJS from "crypto-js";
import { ENV } from "./_core/env";

// JWT_SECRET을 암호화 키로 활용 (서버사이드 전용)
function getEncryptionKey(): string {
  return ENV.cookieSecret || "kis-auto-trader-default-key-change-me";
}

export function encrypt(plainText: string): string {
  if (!plainText) return "";
  return CryptoJS.AES.encrypt(plainText, getEncryptionKey()).toString();
}

export function decrypt(cipherText: string): string {
  if (!cipherText) return "";
  try {
    const bytes = CryptoJS.AES.decrypt(cipherText, getEncryptionKey());
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return "";
  }
}
