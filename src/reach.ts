import { isTestFile } from "./files.js";
import { chainTo, type ModuleGraph } from "./graph.js";
import { directParents, type DepGraph } from "./lockfile.js";
import { packageOf, type ParsedFile } from "./parse.js";
import type { Alert, Result, Side, Verdict } from "./types.js";

/** One place a package is imported. */
export interface PackageUse {
  file: string;
  line: number;
  spec: string;
  bindings: { local: string; imported: string }[];
}

/** package name -> every non-type-only import of it. */
export function packageUses(parsed: ParsedFile[]): Map<string, PackageUse[]> {
  const map = new Map<string, PackageUse[]>();
  for (const f of parsed) {
    for (const imp of f.imports) {
      if (imp.typeOnly) continue;
      const pkg = packageOf(imp.spec);
      if (!pkg) continue;
      const list = map.get(pkg) ?? [];
      list.push({ file: f.path, line: imp.line, spec: imp.spec, bindings: imp.bindings });
      map.set(pkg, list);
    }
  }
  return map;
}

/** Advisory function names come as "template", "lodash.template", "_.template", "lodash#template" or "template()". */
export const fnName = (f: string) => f.replace(/\(.*$/, "").split(/[.#:/]/).pop()!.trim();

/** Calls of a vulnerable function through this import: file:line strings. Empty when not used. */
export function vulnerableCalls(use: PackageUse, pkg: string, fns: string[], file: ParsedFile): string[] {
  const hits = new Set<string>();
  const subpath = use.spec.slice(pkg.length + 1); // "lodash/template" -> "template"
  for (const fn of fns) {
    // import t from "lodash/template", or import clsx from "clsx": the module itself is the vulnerable function
    const subMatch = subpath ? subpath === fn || subpath.split("/").pop()!.replace(/\.[cm]?js$/, "") === fn : pkg.split("/").pop() === fn;
    for (const b of use.bindings) {
      const direct = b.imported === fn || (subMatch && (b.imported === "default" || b.imported === "*"));
      if (direct) {
        if (!b.local) {
          hits.add(`${use.file}:${use.line}`); // re-exported as is
          continue;
        }
        const calls = file.calls.filter((c) => c.callee.length === 1 && c.callee[0] === b.local);
        if (calls.length) for (const c of calls) hits.add(`${use.file}:${c.line}`);
        else hits.add(`${use.file}:${use.line}`); // imported by name, passed around: count it as used
      }
      if ((b.imported === "default" || b.imported === "*") && b.local && !subpath) {
        for (const c of file.calls) if (c.callee.length >= 2 && c.callee[0] === b.local && c.callee[1] === fn) hits.add(`${use.file}:${c.line}`);
      }
    }
    if (subMatch && subpath && !use.bindings.length) hits.add(`${use.file}:${use.line}`); // side-effect import of the function module
  }
  return [...hits];
}

function list(items: string[], max = 3): string {
  const shown = items.slice(0, max).map((s) => `\`${s}\``).join(", ");
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}

export interface ReachInput {
  alerts: Alert[];
  parsed: ParsedFile[];
  graph: ModuleGraph;
  deps: DepGraph;
}

export function checkReach({ alerts, parsed, graph, deps }: ReachInput): Result[] {
  const uses = packageUses(parsed);
  const byPath = new Map(parsed.map((f) => [f.path, f]));
  const live = (u: PackageUse) => graph.reached.has(u.file) && !isTestFile(u.file);
  const sidesOf = (files: string[]): Side[] => {
    const s = new Set<Side>();
    for (const f of files) for (const side of graph.reached.get(f) ?? []) if (side !== "unknown") s.add(side);
    return (["client", "server"] as Side[]).filter((x) => s.has(x));
  };
  const uniq = (xs: string[]) => [...new Set(xs)];

  const results = alerts.map((alert): Result => {
    const name = alert.package;
    const all = uses.get(name) ?? [];
    const liveUses = all.filter(live);
    const make = (verdict: Verdict, evidence: string, locations: string[] = [], files: string[] = []): Result => {
      const r: Result = { alert, verdict, evidence, locations, sides: sidesOf(files) };
      const first = locations[0]?.replace(/:\d+$/, "");
      if (first && graph.reached.has(first)) r.chain = chainTo(graph, first);
      return r;
    };

    if (liveUses.length) {
      const files = uniq(liveUses.map((u) => u.file));
      const fns = uniq(alert.functions.map(fnName).filter(Boolean));
      if (fns.length) {
        const hits = uniq(liveUses.flatMap((u) => vulnerableCalls(u, name, fns, byPath.get(u.file)!)));
        if (hits.length) {
          const hitFiles = uniq(hits.map((h) => h.replace(/:\d+$/, "")));
          return make("called", `Vulnerable function ${list(fns)} used at ${list(hits)}.`, hits, hitFiles);
        }
        return make("imported-safe", `Loaded by ${list(files)}, but the vulnerable function ${list(fns)} is not used there.`, liveUses.map((u) => `${u.file}:${u.line}`), files);
      }
      return make(
        "reachable",
        `Loaded by ${files.length} shipped file${files.length > 1 ? "s" : ""}: ${list(files)}. The advisory names no vulnerable function.`,
        liveUses.map((u) => `${u.file}:${u.line}`),
        files,
      );
    }

    const parents = directParents(deps, name);
    const liveParents = parents.filter((p) => (uses.get(p) ?? []).some(live));
    const isDev = alert.scope === "development" || deps.direct.get(name)?.dev === true || (parents.length > 0 && parents.every((p) => deps.direct.get(p)?.dev));

    if (liveParents.length) {
      const parentUses = liveParents.flatMap((p) => (uses.get(p) ?? []).filter(live));
      const files = uniq(parentUses.map((u) => u.file));
      return make(
        "via-dependency",
        `Pulled in by ${list(liveParents)}, which shipped code loads (${list(files)}). Check whether ${liveParents.length > 1 ? "they call" : "it calls"} the vulnerable code.`,
        parentUses.map((u) => `${u.file}:${u.line}`),
        files,
      );
    }
    if (isDev && !all.some((u) => !isTestFile(u.file))) {
      return make("dev-only", parents.length && !deps.direct.has(name) ? `Only pulled in by dev dependencies: ${list(parents)}.` : "Dev dependency. It does not ship to production.");
    }

    const deadUses = all.filter((u) => !isTestFile(u.file));
    const deadParentUses = parents.flatMap((p) => (uses.get(p) ?? []).filter((u) => !isTestFile(u.file)));
    if (deadUses.length || deadParentUses.length) {
      const files = uniq((deadUses.length ? deadUses : deadParentUses).map((u) => u.file));
      const how = deadUses.length ? "Imported only" : `Pulled in by ${list(parents)}, imported only`;
      return make("dead-code", `${how} in files no entry point reaches: ${list(files)}. Safe to delete those, or this is lower priority.`, (deadUses.length ? deadUses : deadParentUses).map((u) => `${u.file}:${u.line}`));
    }
    if (all.length || parents.some((p) => uses.has(p))) {
      const files = uniq([...all, ...parents.flatMap((p) => uses.get(p) ?? [])].map((u) => u.file));
      return make("test-only", `Only imported in tests: ${list(files)}.`);
    }
    if (!deps.known && !deps.direct.has(name)) {
      return make("unknown", "Transitive, and there is no lockfile dependency graph to follow.");
    }
    return make("not-imported", parents.length ? `Pulled in by ${list(parents)}, but your code loads none of them.` : "Your code never loads it.");
  });

  return results.sort(
    (a, b) =>
      ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) ||
      Number(b.sides.includes("client")) - Number(a.sides.includes("client")) ||
      sevRank(a.alert.severity) - sevRank(b.alert.severity) ||
      a.alert.number - b.alert.number,
  );
}

export const ORDER: Verdict[] = ["called", "reachable", "via-dependency", "unknown", "imported-safe", "dead-code", "not-imported", "test-only", "dev-only"];
const SEV = ["critical", "high", "medium", "low"];
export const sevRank = (s: string) => {
  const i = SEV.indexOf(s === "moderate" ? "medium" : s);
  return i < 0 ? SEV.length : i;
};

/** Verdicts that need action first: shipped code really loads the vulnerable package. */
export const isReachable = (r: Result) => r.verdict === "called" || r.verdict === "reachable" || r.verdict === "via-dependency";
