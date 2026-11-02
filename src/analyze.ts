import { readOptional, readSources } from "./files.js";
import { buildGraph, findEntries, type ModuleGraph } from "./graph.js";
import { dependencyGraph, LOCKFILES } from "./lockfile.js";
import { parseFile } from "./parse.js";
import { checkReach } from "./reach.js";
import type { ReportMeta } from "./report.js";
import { loadAliases } from "./resolve.js";
import type { Alert, Result } from "./types.js";

export interface AnalyzeOptions {
  root?: string;
  /** Extra entry point globs, relative to root. */
  entries?: string[];
}

export interface Analysis {
  results: Result[];
  meta: ReportMeta;
  graph: ModuleGraph;
}

const BROWSER_APP = ["vite", "react-scripts", "@vitejs/plugin-react", "parcel", "@angular/core", "vue", "svelte"];

/** Scans the project at `root` and gives every alert a reachability verdict. */
export function analyze(alerts: Alert[], opts: AnalyzeOptions = {}): Analysis {
  const root = opts.root ?? ".";
  const read = (p: string) => readOptional(root, p);
  const sources = readSources(root);
  const parsed = sources.map((f) => parseFile(f.path, f.text));

  let pkg: any;
  try {
    pkg = JSON.parse(read("package.json") ?? "null") ?? undefined;
  } catch {
    pkg = undefined;
  }
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const isNext = "next" in deps;
  const browserApp = !isNext && BROWSER_APP.some((d) => d in deps);

  const entries = findEntries(
    parsed.map((f) => f.path),
    { packageJson: pkg, extra: opts.entries, browserApp },
  );
  const graph = buildGraph(parsed, entries, loadAliases(read));
  const lockName = LOCKFILES.find((l) => read(l) !== undefined);
  const depGraph = dependencyGraph(lockName ? read(lockName) : undefined, pkg);
  const results = checkReach({ alerts, parsed, graph, deps: depGraph });
  return {
    results,
    graph,
    meta: {
      entries: graph.fallback ? 0 : graph.entries.length,
      files: parsed.length,
      reachedFiles: graph.reached.size,
      fallback: graph.fallback,
      parseErrors: parsed.filter((p) => p.error).length,
    },
  };
}

