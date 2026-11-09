/** One open Dependabot alert, reduced to what ReachCheck needs. */
export interface Alert {
  number: number;
  package: string;
  severity: string;
  ghsa: string;
  cve?: string;
  summary: string;
  manifest?: string;
  scope?: "runtime" | "development" | null;
  vulnerableRange?: string;
  patched?: string;
  /** Vulnerable functions from the advisory, e.g. ["template"] or ["lodash.template"]. */
  functions: string[];
  url?: string;
}

export type Side = "client" | "server";

export type Verdict =
  | "called" // vulnerable function used from shipped code
  | "reachable" // package loaded by shipped code; advisory names no function
  | "via-dependency" // transitive; a direct dependency that pulls it in is loaded by shipped code
  | "unknown" // not enough data
  | "imported-safe" // loaded by shipped code, named vulnerable function not used
  | "dead-code" // only imported by files no entry point reaches
  | "not-imported" // in the lockfile, never loaded by your code
  | "test-only" // only imported by tests
  | "dev-only"; // dev dependency

export interface Result {
  alert: Alert;
  verdict: Verdict;
  /** Where it ships, when known. */
  sides: Side[];
  /** One-line human explanation. */
  evidence: string;
  /** file:line locations (calls or imports) backing the verdict. */
  locations: string[];
  /** Import chain from an entry point to the first location, e.g. ["app/page.tsx", "lib/price.ts"]. */
  chain?: string[];
}
