import { globToRegExp, isTestFile } from "./files.js";
import type { ParsedFile } from "./parse.js";
import { resolveImport, type PathAliases } from "./resolve.js";
import type { Side } from "./types.js";

export interface Entry {
  path: string;
  /** Where this entry runs; undefined when we can't tell (plain Node or library code). */
  side?: Side | "both";
  why: string;
}

export interface ModuleGraph {
  entries: Entry[];
  /** Project files reached from an entry, with the sides they run on ("unknown" when not known). */
  reached: Map<string, Set<Side | "unknown">>;
  /** Parent pointer for each reached file: how we got there. */
  via: Map<string, string | undefined>;
  /** Local import edges: file -> resolved project files. */
  edges: Map<string, string[]>;
  /** True when no entry point was found and every non-test file was treated as an entry. */
  fallback: boolean;
}

const NEXT_APP = /(^|\/)(src\/)?app\/(.*\/)?(page|layout|template|route|loading|error|global-error|not-found|default|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.[cm]?[jt]sx?$/;
const NEXT_PAGES = /(^|\/)(src\/)?pages\/.+\.[cm]?[jt]sx?$/;
const NEXT_SERVER = /^(src\/)?(middleware|instrumentation|instrumentation-client|proxy)\.[cm]?[jt]s$|^next\.config\.[cm]?[jt]s$/;
const COMMON = /^(src\/)?(index|main|server|app|cli)\.[cm]?[jt]sx?$/;

export interface EntryOptions {
  packageJson?: any;
  /** Extra entry globs from the user. */
  extra?: string[];
  /** True when the project looks like a browser app (Vite, CRA): common entries are client code. */
  browserApp?: boolean;
}

export function findEntries(paths: string[], opts: EntryOptions = {}): Entry[] {
  const out = new Map<string, Entry>();
  const add = (path: string, side: Entry["side"], why: string) => {
    if (!out.has(path) && !isTestFile(path)) out.set(path, { path, side, why });
  };
  const set = new Set(paths);
  const pkg = opts.packageJson ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const isNext = "next" in deps || paths.some((p) => /^next\.config\./.test(p));

  for (const p of paths) {
    if (isNext && NEXT_APP.test(p)) add(p, "server", "Next.js app route");
    else if (isNext && NEXT_PAGES.test(p)) add(p, /(^|\/)pages\/api\//.test(p) ? "server" : "both", "Next.js page");
    else if (isNext && NEXT_SERVER.test(p)) add(p, "server", "Next.js server file");
  }

  const fromPkg = (value: unknown) => {
    if (typeof value === "string") {
      const p = value.replace(/^\.\//, "");
      // package.json usually points at build output; map dist/x.js back to src/x.ts when only the source exists
      const candidates = [p, p.replace(/^(dist|build|lib|out)\//, "src/")];
      for (const c of candidates) {
        const base = c.replace(/\.(c|m)?jsx?$/, "");
        for (const cand of [c, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mts`, `${base}.mjs`]) {
          if (set.has(cand)) return add(cand, opts.browserApp ? "client" : undefined, "package.json entry");
        }
      }
    } else if (value && typeof value === "object") for (const v of Object.values(value)) fromPkg(v);
  };
  fromPkg(pkg.main);
  fromPkg(pkg.module);
  fromPkg(pkg.browser);
  fromPkg(pkg.bin);
  fromPkg(pkg.exports);

  if (!isNext || out.size === 0) {
    for (const p of paths) if (COMMON.test(p)) add(p, opts.browserApp ? "client" : undefined, "common entry file");
  }

  for (const glob of opts.extra ?? []) {
    const re = globToRegExp(glob);
    for (const p of paths) if (re.test(p)) add(p, undefined, `--entry ${glob}`);
  }
  return [...out.values()];
}

/** Walks local imports from the entries and records which files ship and on which side. */
export function buildGraph(parsed: ParsedFile[], entries: Entry[], aliases: PathAliases): ModuleGraph {
  const files = new Set(parsed.map((f) => f.path));
  const byPath = new Map(parsed.map((f) => [f.path, f]));
  const edges = new Map<string, string[]>();
  for (const f of parsed) {
    const targets: string[] = [];
    for (const imp of f.imports) {
      if (imp.typeOnly) continue;
      const hit = resolveImport(f.path, imp.spec, files, aliases);
      if (hit && hit !== f.path && !targets.includes(hit)) targets.push(hit);
    }
    edges.set(f.path, targets);
  }

  let fallback = false;
  let seeds = entries;
  if (!seeds.length) {
    fallback = true;
    seeds = parsed.filter((f) => !isTestFile(f.path)).map((f) => ({ path: f.path, why: "no entry points found" }));
  }

  const reached = new Map<string, Set<Side | "unknown">>();
  const via = new Map<string, string | undefined>();
  const queue: [string, Side | "unknown", string | undefined][] = [];
  const sideOfFile = (path: string, inherited: Side | "unknown"): Side | "unknown" => {
    const d = byPath.get(path)?.directive;
    if (d === "client") return "client"; // "use client" starts a client boundary
    if (d === "server") return "server"; // server actions run on the server even when a client file imports them
    return inherited;
  };
  for (const e of seeds) {
    const sides: (Side | "unknown")[] = e.side === "both" ? ["server", "client"] : [e.side ?? "unknown"];
    for (const s of sides) queue.push([e.path, sideOfFile(e.path, s), undefined]);
  }
  while (queue.length) {
    const [path, side, from] = queue.shift()!;
    let sides = reached.get(path);
    if (!sides) {
      sides = new Set();
      reached.set(path, sides);
      via.set(path, from);
    }
    if (sides.has(side)) continue;
    sides.add(side);
    for (const next of edges.get(path) ?? []) queue.push([next, sideOfFile(next, side), path]);
  }
  return { entries: seeds, reached, via, edges, fallback };
}

/** Import chain from an entry to `path`, e.g. ["app/page.tsx", "lib/a.ts", path]. */
export function chainTo(graph: ModuleGraph, path: string): string[] {
  const chain: string[] = [];
  let cur: string | undefined = path;
  while (cur !== undefined && !chain.includes(cur)) {
    chain.unshift(cur);
    cur = graph.via.get(cur);
  }
  return chain;
}
