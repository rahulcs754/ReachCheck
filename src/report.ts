import { isReachable } from "./reach.js";
import type { Result, Verdict } from "./types.js";

export const LABEL: Record<Verdict, string> = {
  called: "🔴 Called",
  reachable: "🟠 Reachable",
  "via-dependency": "🟠 Via dependency",
  unknown: "❔ Unknown",
  "imported-safe": "🟡 Function not used",
  "dead-code": "⚪ Dead code only",
  "not-imported": "⚪ Not imported",
  "test-only": "⚪ Tests only",
  "dev-only": "⚪ Dev only",
};

export interface ReportMeta {
  entries: number;
  files: number;
  reachedFiles: number;
  fallback: boolean;
  parseErrors: number;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const sideText = (r: Result) => (r.sides.length === 2 ? "client + server" : r.sides[0] ?? "");

export function renderMarkdown(results: Result[], meta: ReportMeta, max = 100): string {
  const lines = ["## ReachCheck: open Dependabot alerts", ""];
  if (!results.length) {
    lines.push("No open npm Dependabot alerts. ✅");
    return lines.join("\n");
  }
  const reachable = results.filter(isReachable);
  const client = reachable.filter((r) => r.sides.includes("client")).length;
  lines.push(
    `**${reachable.length}** of ${results.length} open alert${results.length > 1 ? "s" : ""} reach shipped code${client ? ` (**${client}** in the browser bundle)` : ""}. Fix those first.`,
    "",
    "| Verdict | Side | Alert | Package | Severity | Why | Fix |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const r of results.slice(0, max)) {
    const a = r.alert;
    const alertCell = a.url ? `[#${a.number}](${a.url})` : `#${a.number}`;
    const chain = r.chain && r.chain.length > 1 ? `<br><sub>${cell(r.chain.join(" → "))}</sub>` : "";
    lines.push(
      `| ${LABEL[r.verdict]} | ${sideText(r)} | ${alertCell} ${cell(a.summary)} | \`${a.package}\` | ${a.severity} | ${cell(r.evidence)}${chain} | ${a.patched ? `Upgrade to ${a.patched}` : "No patch yet"} |`,
    );
  }
  if (results.length > max) lines.push(`| | | and ${results.length - max} more | | | | |`);
  lines.push("");
  const notes = [`Scanned ${meta.files} files from ${meta.entries} entry point${meta.entries === 1 ? "" : "s"}; ${meta.reachedFiles} ship.`];
  if (meta.fallback) notes.push("No entry points found, so every non-test file counted as shipped. Pass `--entry` (or the `entries` input) for sharper results.");
  if (meta.parseErrors) notes.push(`${meta.parseErrors} file(s) could not be parsed and were skipped.`);
  notes.push("Static analysis of imports and calls: \"not imported\" means lower priority, not safe forever.");
  lines.push(`<sub>${notes.join(" ")}</sub>`);
  return lines.join("\n");
}

export function renderJson(results: Result[], meta: ReportMeta): string {
  return JSON.stringify({ meta, summary: summarize(results), results }, null, 2);
}

export function summarize(results: Result[]): Record<Verdict | "total", number> {
  const out = { total: results.length } as Record<Verdict | "total", number>;
  for (const v of Object.keys(LABEL) as Verdict[]) out[v] = results.filter((r) => r.verdict === v).length;
  return out;
}

const SEVERITIES = ["low", "medium", "high", "critical"];

/** Error message when a reachable alert is at or above `level` ("none" never fails), else undefined. */
export function failure(results: Result[], level: string): string | undefined {
  const min = SEVERITIES.indexOf(level);
  if (min < 0) return undefined;
  const sev = (s: string) => SEVERITIES.indexOf(s === "moderate" ? "medium" : s);
  const bad = results.filter((r) => isReachable(r) && sev(r.alert.severity) >= min);
  return bad.length ? `${bad.length} reachable Dependabot alert(s) at ${level} or above: ${[...new Set(bad.map((r) => r.alert.package))].join(", ")}` : undefined;
}
