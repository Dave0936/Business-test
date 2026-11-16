import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SiteFiles } from "@/lib/sites/spec";

const run = promisify(execFile);
const API = "https://api.cloudflare.com/client/v4";

export interface CloudflareCreds {
  apiToken: string;
  accountId: string;
}

interface CfEnvelope<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

async function cf<T>(creds: CloudflareCreds, method: string, p: string, body?: unknown): Promise<{ status: number; json: CfEnvelope<T> }> {
  const res = await fetch(`${API}/accounts/${creds.accountId}${p}`, {
    method,
    headers: { authorization: `Bearer ${creds.apiToken}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({ success: false, errors: [{ code: res.status, message: res.statusText }], result: null }))) as CfEnvelope<T>;
  return { status: res.status, json };
}

/** Pages project names: lowercase letters, digits and dashes, max 58 chars. */
export function projectNameFor(prefix: string, slug: string): string {
  return `${prefix}-${slug}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 58);
}

export async function ensureProject(creds: CloudflareCreds, name: string): Promise<{ created: boolean; subdomain: string }> {
  const got = await cf<{ subdomain: string }>(creds, "GET", `/pages/projects/${name}`);
  if (got.status === 200 && got.json.success) return { created: false, subdomain: got.json.result.subdomain };
  if (got.status !== 404) throw new Error(`Cloudflare: could not read project (${got.json.errors?.[0]?.message ?? got.status})`);
  const made = await cf<{ subdomain: string }>(creds, "POST", "/pages/projects", { name, production_branch: "main" });
  if (!made.json.success) throw new Error(`Cloudflare: could not create project (${made.json.errors?.[0]?.message ?? made.status})`);
  return { created: true, subdomain: made.json.result.subdomain };
}

/**
 * Writes the approved files to an isolated temp directory and uploads them with
 * `wrangler pages deploy` (Cloudflare Direct Upload). The site is static: nothing
 * in it is executed on our servers.
 */
export async function uploadWithWrangler(creds: CloudflareCreds, projectName: string, files: SiteFiles, commitMessage: string): Promise<{ deploymentId: string | null; url: string | null; log: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "wo-deploy-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const safe = path.normalize(name).replace(/^(\.\.(\/|\\|$))+/, "");
      if (safe.startsWith("..") || path.isAbsolute(safe)) throw new Error(`Refusing unsafe file path ${name}`);
      const dest = path.join(dir, safe);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, typeof content === "string" ? content : Buffer.from(content.base64, "base64"));
    }
    const wrangler = path.join(process.cwd(), "node_modules", ".bin", "wrangler");
    const { stdout, stderr } = await run(
      wrangler,
      ["pages", "deploy", dir, "--project-name", projectName, "--branch", "main", "--commit-message", commitMessage.slice(0, 200), "--commit-dirty=true"],
      {
        timeout: 180_000,
        maxBuffer: 5_000_000,
        // Only what wrangler needs: no other secrets from our environment are passed.
        env: {
          PATH: process.env.PATH ?? "",
          HOME: dir,
          CLOUDFLARE_API_TOKEN: creds.apiToken,
          CLOUDFLARE_ACCOUNT_ID: creds.accountId,
          WRANGLER_SEND_METRICS: "false",
          CI: "true",
          NODE_ENV: "production",
          ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
          ...(process.env.NODE_EXTRA_CA_CERTS ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS } : {}),
        },
      },
    );
    const log = `${stdout}\n${stderr}`;
    const url = log.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev/i)?.[0] ?? null;
    return { deploymentId: null, url, log: log.slice(-4000) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

interface CfDeployment {
  id: string;
  url: string;
  environment: string;
  latest_stage: { name: string; status: string };
  aliases: string[] | null;
  created_on: string;
}

/** Ask Cloudflare (not wrangler's console output) whether the deployment succeeded. */
export async function latestDeployment(creds: CloudflareCreds, projectName: string): Promise<CfDeployment | null> {
  const r = await cf<CfDeployment[]>(creds, "GET", `/pages/projects/${projectName}/deployments?per_page=1`);
  if (!r.json.success) throw new Error(`Cloudflare: could not list deployments (${r.json.errors?.[0]?.message ?? r.status})`);
  return r.json.result[0] ?? null;
}

export async function waitForDeployment(creds: CloudflareCreds, projectName: string, notBefore: Date, timeoutMs = 120_000): Promise<CfDeployment> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const d = await latestDeployment(creds, projectName);
    if (d && new Date(d.created_on) >= new Date(notBefore.getTime() - 5000)) {
      if (d.latest_stage.status === "success") return d;
      if (d.latest_stage.status === "failure" || d.latest_stage.status === "canceled") throw new Error(`Cloudflare reports deployment ${d.id} ${d.latest_stage.status} at stage ${d.latest_stage.name}`);
    }
    if (Date.now() > deadline) throw new Error("Timed out waiting for Cloudflare to confirm the deployment");
    await new Promise((r) => setTimeout(r, 4000));
  }
}

/** Fetch the live URL and check it serves this exact version (marker in index.html). */
export async function verifyLive(url: string, expectedMarker: string): Promise<{ ok: boolean; status: number; reason?: string }> {
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(url, { redirect: "follow", headers: { "cache-control": "no-cache" } });
      const body = await res.text();
      if (res.ok && body.includes(expectedMarker)) return { ok: true, status: res.status };
      if (i === 5) return { ok: false, status: res.status, reason: res.ok ? "Live page does not contain this version's marker" : `HTTP ${res.status}` };
    } catch (e) {
      if (i === 5) return { ok: false, status: 0, reason: (e as Error).message };
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { ok: false, status: 0, reason: "unreachable" };
}
