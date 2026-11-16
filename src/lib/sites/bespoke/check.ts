import { runQaChecks } from "@/lib/qa/checks";
import type { SiteSpec } from "../spec";
import { assembleBespoke, type AssembleContext } from "./assemble";
import type { CheckOutcome } from "./tools";

/** The check Claude runs: assemble exactly as published, then the full quality checks. */
export function makeChecker(assemble: AssembleContext, spec: SiteSpec, localAssets: string[] = []) {
  return (source: Record<string, string>): CheckOutcome => {
    const { files } = assembleBespoke(source, assemble);
    // Bundled photos are added when the version is saved; count them as present here.
    for (const a of localAssets) files[a] = { base64: "", contentType: "image/png" };
    const report = runQaChecks(files, spec, { verified: { phone: assemble.facts.phone, email: assemble.facts.email, name: assemble.facts.name }, agencyName: assemble.agencyName });
    return {
      passed: report.passed,
      failures: report.checks.filter((c) => c.status === "fail").flatMap((c) => c.details.filter((d) => !d.startsWith("Warning:")).map((d) => `[${c.label}] ${d}`)),
      warnings: report.checks.flatMap((c) => c.details.filter((d) => d.startsWith("Warning:")).map((d) => `[${c.label}] ${d.replace(/^Warning: /, "")}`)),
    };
  };
}

