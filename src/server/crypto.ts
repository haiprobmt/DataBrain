import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "@/lib/utils";

export const sha256 = (input: string | Uint8Array) => createHash("sha256").update(input).digest("hex");
export const hashJson = (value: unknown) => sha256(canonicalJson(value));
export const hmac = (secret: string, input: string) => createHmac("sha256", secret).update(input).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  return safeEqual(scryptSync(password, salt, 64).toString("hex"), hash);
}
