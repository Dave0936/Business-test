import type Anthropic from "@anthropic-ai/sdk";
import { MAX_FILE_BYTES, MAX_PAGES, isAllowedSourcePath } from "./assemble";

/**
 * The builder's tools. They act only on the build's in-memory draft files: no network, no
 * database, no file system. check_site runs our own quality checks; finish is accepted only
 * after a passing check with no edits since.
 */

export const BUILD_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: "write_file",
    description: "Create or replace one file of the site. Allowed: up to 8 pages named like index.html or contact.html (lowercase letters, digits, hyphens), plus styles.css and script.js. Write the complete file every time.",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } },
  },
  {
    name: "read_file",
    description: "Read one file of the current draft.",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, required: ["path"], properties: { path: { type: "string" } } },
  },
  {
    name: "delete_file",
    description: "Delete one page from the draft (not styles.css or script.js).",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, required: ["path"], properties: { path: { type: "string" } } },
  },
  {
    name: "list_files",
    description: "List the draft's files with their sizes.",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    name: "check_site",
    description: "Run the quality checks on the draft as it will be published (placeholders filled, concept notice added): build, links, assets, responsive layout, accessibility and contrast, security, forms, SEO, and honesty (no invented claims or contact details). Returns every failure to fix.",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    name: "finish",
    description: "Finish the build. Only accepted when the latest check_site passed and nothing changed since. Give a short summary of the design and up to five suggestions for the designer.",
    strict: true,
    input_schema: {
      type: "object", additionalProperties: false, required: ["summary", "suggestions"],
      properties: { summary: { type: "string" }, suggestions: { type: "array", items: { type: "string" } } },
    },
  },
];

export interface CheckOutcome {
  passed: boolean;
  failures: string[];
  warnings: string[];
}

export interface DraftState {
  source: Record<string, string>;
  /** Result of the latest check, and whether files changed since. */
  lastCheck: CheckOutcome | null;
  dirtySinceCheck: boolean;
  finished: { summary: string; suggestions: string[] } | null;
  /** Page limit for this build (8 per language). */
  maxPages?: number;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
  activity: string;
}

export function executeBuildTool(state: DraftState, name: string, input: Record<string, unknown>, check: (source: Record<string, string>) => CheckOutcome): ToolOutcome {
  const err = (content: string, activity = content): ToolOutcome => ({ content, isError: true, activity });
  switch (name) {
    case "write_file": {
      const path = String(input.path ?? "").trim();
      const content = String(input.content ?? "");
      if (!isAllowedSourcePath(path)) return err(`"${path}" is not an allowed file name. Use pages like about.html (or fr/about.html for a translation), plus styles.css and script.js.`, `Refused file name ${path}`);
      if (Buffer.byteLength(content) > MAX_FILE_BYTES) return err(`${path} is too large (limit ${MAX_FILE_BYTES / 1000} KB). Split or simplify it.`);
      const pages = Object.keys(state.source).filter((p) => p.endsWith(".html"));
      const limit = state.maxPages ?? MAX_PAGES;
      if (path.endsWith(".html") && !state.source[path] && pages.length >= limit) return err(`The site already has ${limit} pages. Delete one first.`);
      const existed = path in state.source;
      state.source[path] = content;
      state.dirtySinceCheck = true;
      return { content: `${existed ? "Updated" : "Created"} ${path} (${Math.round(Buffer.byteLength(content) / 100) / 10} KB).`, isError: false, activity: `${existed ? "Updated" : "Wrote"} ${path}` };
    }
    case "read_file": {
      const path = String(input.path ?? "");
      if (!(path in state.source)) return err(`${path} does not exist. Files: ${Object.keys(state.source).join(", ") || "none"}.`, `Tried to read missing ${path}`);
      return { content: state.source[path], isError: false, activity: `Read ${path}` };
    }
    case "delete_file": {
      const path = String(input.path ?? "");
      if (!path.endsWith(".html") || !(path in state.source)) return err(`Only existing pages can be deleted (${path}).`);
      if (path === "index.html") return err("The home page cannot be deleted.");
      delete state.source[path];
      state.dirtySinceCheck = true;
      return { content: `Deleted ${path}.`, isError: false, activity: `Deleted ${path}` };
    }
    case "list_files": {
      const list = Object.entries(state.source).map(([p, c]) => `${p} (${Math.round(Buffer.byteLength(c) / 100) / 10} KB)`);
      return { content: list.length ? list.join("\n") : "No files yet.", isError: false, activity: "Listed files" };
    }
    case "check_site": {
      if (!state.source["index.html"]) return err("There is no index.html yet.", "Checked: no home page yet");
      const r = check(state.source);
      state.lastCheck = r;
      state.dirtySinceCheck = false;
      const body = r.passed
        ? `All checks passed.${r.warnings.length ? `\nWarnings worth fixing:\n- ${r.warnings.slice(0, 15).join("\n- ")}` : ""}`
        : `${r.failures.length} problem(s) to fix:\n- ${r.failures.slice(0, 40).join("\n- ")}${r.failures.length > 40 ? `\n…and ${r.failures.length - 40} more.` : ""}`;
      return { content: body, isError: false, activity: r.passed ? "Checks passed" : `Checks found ${r.failures.length} problem(s)` };
    }
    case "finish": {
      if (!state.lastCheck) return err("Run check_site first.");
      if (state.dirtySinceCheck) return err("Files changed since the last check. Run check_site again.");
      if (!state.lastCheck.passed) return err("The last check failed. Fix the problems and run check_site again.");
      const summary = String(input.summary ?? "").slice(0, 1500);
      const suggestions = (Array.isArray(input.suggestions) ? input.suggestions : []).map((s) => String(s).slice(0, 300)).slice(0, 5);
      state.finished = { summary, suggestions };
      return { content: "Build finished.", isError: false, activity: "Finished" };
    }
    default:
      return err(`Unknown tool ${name}.`);
  }
}
