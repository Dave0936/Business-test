import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHmac, randomBytes } from "node:crypto";
import { suppressionFor, verifySvix } from "@/lib/email/webhook";

const rawKey = randomBytes(24);
const SECRET = `whsec_${rawKey.toString("base64")}`;
const sign = (id: string, ts: string, body: string, key = rawKey) => `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;

describe("Resend webhook signatures (Svix)", () => {
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "abc" } });
  const now = 1_800_000_000;
  const ts = String(now);

  it("accepts a correctly signed, fresh event", () => {
    expect(verifySvix(SECRET, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, body, now)).toBe(true);
  });

  it("accepts any matching signature when several are sent (secret rotation)", () => {
    const sig = `v1,${randomBytes(32).toString("base64")} ${sign("msg_1", ts, body)}`;
    expect(verifySvix(SECRET, { id: "msg_1", timestamp: ts, signature: sig }, body, now)).toBe(true);
  });

  it("rejects a changed body, a wrong secret, a replayed old event and missing headers", () => {
    expect(verifySvix(SECRET, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, body.replace("delivered", "complained"), now)).toBe(false);
    expect(verifySvix(SECRET, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body, randomBytes(24)) }, body, now)).toBe(false);
    expect(verifySvix(SECRET, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, body, now + 3600)).toBe(false);
    expect(verifySvix(SECRET, { id: null, timestamp: ts, signature: sign("msg_1", ts, body) }, body, now)).toBe(false);
    expect(verifySvix("", { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, body, now)).toBe(false);
  });
});

describe("which events suppress an address", () => {
  it("suppresses complaints and permanent bounces only", () => {
    expect(suppressionFor({ type: "email.complained" })).toBe("complained");
    expect(suppressionFor({ type: "email.bounced", data: { bounce: { type: "Permanent" } } })).toBe("bounced");
    expect(suppressionFor({ type: "email.bounced", data: { bounce: { type: "Transient" } } })).toBeNull();
    expect(suppressionFor({ type: "email.delivered" })).toBeNull();
    expect(suppressionFor({ type: "email.opened" })).toBeNull();
  });
});
