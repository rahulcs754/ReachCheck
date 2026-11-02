import { createHash } from "node:crypto";
import type { Result } from "./types.js";

/** OpenVEX v0.2.0 document: one statement per alert, so "not affected" verdicts are recorded with a reason. */
export function renderVex(results: Result[], opts: { product: string; author?: string; timestamp?: string }): string {
  const timestamp = opts.timestamp ?? new Date().toISOString();
  const statements = results.map((r) => {
    const a = r.alert;
    const base: Record<string, unknown> = {
      vulnerability: { name: a.ghsa || a.cve || `alert-${a.number}`, ...(a.cve && a.ghsa ? { aliases: [a.cve] } : {}) },
      products: [{ "@id": opts.product, subcomponents: [{ "@id": `pkg:npm/${a.package.replace(/^@/, "%40")}` }] }],
    };
    switch (r.verdict) {
      case "called":
      case "reachable":
      case "via-dependency":
        return { ...base, status: "affected", action_statement: a.patched ? `Upgrade ${a.package} to ${a.patched} or later. ${r.evidence}` : `No patched version yet. ${r.evidence}` };
      case "imported-safe":
      case "dead-code":
      case "not-imported":
      case "test-only":
        return { ...base, status: "not_affected", justification: "vulnerable_code_not_in_execute_path", impact_statement: `ReachCheck: ${r.evidence}` };
      case "dev-only":
        return { ...base, status: "not_affected", justification: "component_not_present", impact_statement: `ReachCheck: ${r.evidence}` };
      default:
        return { ...base, status: "under_investigation" };
    }
  });
  const id = createHash("sha256").update(JSON.stringify(statements)).digest("hex").slice(0, 16);
  return JSON.stringify(
    {
      "@context": "https://openvex.dev/ns/v0.2.0",
      "@id": `https://openvex.dev/docs/public/reachcheck-${id}`,
      author: opts.author ?? "ReachCheck",
      timestamp,
      version: 1,
      tooling: "ReachCheck",
      statements: statements.map((s) => ({ ...s, timestamp })),
    },
    null,
    2,
  );
}
