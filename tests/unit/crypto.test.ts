import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { parseEncryptionKey } from "@/lib/security/crypto";

describe("APP_ENCRYPTION_KEY formats", () => {
  const raw = randomBytes(32);
  it("uses an exact 32-byte key as it is (base64, base64url, hex)", () => {
    expect(parseEncryptionKey(raw.toString("base64")).equals(raw)).toBe(true);
    expect(parseEncryptionKey(raw.toString("base64url")).equals(raw)).toBe(true);
    expect(parseEncryptionKey(raw.toString("hex")).equals(raw)).toBe(true);
  });
  it("ignores quotes and whitespace from copy and paste", () => {
    expect(parseEncryptionKey(`  "${raw.toString("base64")}"\n`).equals(raw)).toBe(true);
  });
  it("derives a stable 32-byte key from other long random values (e.g. a 32-character hex secret)", () => {
    const hex32 = randomBytes(16).toString("hex");
    const a = parseEncryptionKey(hex32);
    expect(a).toHaveLength(32);
    expect(parseEncryptionKey(hex32).equals(a)).toBe(true);
    expect(parseEncryptionKey(randomBytes(16).toString("hex")).equals(a)).toBe(false);
  });
  it("refuses short values", () => {
    expect(() => parseEncryptionKey("changeme")).toThrow(/too short/);
  });
});
