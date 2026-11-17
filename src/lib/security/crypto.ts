import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** AES-256-GCM for integration secrets stored per organisation. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
function key(): Buffer {
  if (!env.encryptionKey) throw new Error("APP_ENCRYPTION_KEY is not set; cannot store integration secrets.");
  return parseEncryptionKey(env.encryptionKey);
}

/**
 * The AES-256 key from APP_ENCRYPTION_KEY. Accepts a 32-byte key as base64, base64url or hex
 * (used as it is), or any other random value of at least 32 characters, from which a key is
 * derived with HKDF-SHA256. Surrounding quotes and whitespace from copy and paste are ignored.
 */
export function parseEncryptionKey(value: string): Buffer {
  const v = value.trim().replace(/^["']|["']$/g, "").trim();
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, "hex");
  if (/^[A-Za-z0-9+/_-]{43}={0,1}$/.test(v)) {
    const raw = Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (raw.length === 32) return raw;
  }
  if (v.length < 32) throw new Error("APP_ENCRYPTION_KEY is too short: use at least 32 random characters (for example: openssl rand -base64 32).");
  return Buffer.from(hkdfSync("sha256", Buffer.from(v, "utf8"), Buffer.from("webopportunity-ai"), Buffer.from("integration-secrets-v1"), 32));
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
