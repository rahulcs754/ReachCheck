import { dirname, posix } from "node:path";
import { parseJsonc } from "./files.js";

export interface PathAliases {
  /** Directory (relative to root, "" for root) that `paths` entries are relative to. */
  baseUrl?: string;
  paths: { prefix: string; suffix: string; wildcard: boolean; targets: string[] }[];
}

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

/** Reads `compilerOptions.baseUrl` and `paths` from tsconfig.json or jsconfig.json, following one level of local `extends`. */
export function loadAliases(read: (path: string) => string | undefined): PathAliases {
  const out: PathAliases = { paths: [] };
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const text = read(name);
    if (!text) continue;
    let cfg: any;
    try {
      cfg = parseJsonc(text);
    } catch {
      continue;
    }
    let opts = cfg.compilerOptions ?? {};
    let cfgDir = "";
    if (typeof cfg.extends === "string" && cfg.extends.startsWith(".")) {
      const basePath = posix.normalize(cfg.extends.endsWith(".json") ? cfg.extends : `${cfg.extends}.json`);
      const baseText = read(basePath);
      if (baseText) {
        try {
          const base = parseJsonc(baseText).compilerOptions ?? {};
          const baseDir = posix.dirname(basePath);
          if (!opts.paths && base.paths) cfgDir = baseDir;
          opts = { ...base, ...opts, baseUrl: opts.baseUrl ?? (base.baseUrl ? posix.join(baseDir, base.baseUrl) : undefined) };
        } catch {
          // ignore a broken base config
        }
      }
    }
    const baseUrl = opts.baseUrl !== undefined ? clean(posix.normalize(opts.baseUrl)) : undefined;
    out.baseUrl = baseUrl;
    const pathsBase = baseUrl ?? cfgDir;
    for (const [pattern, targets] of Object.entries<string[]>(opts.paths ?? {})) {
      const star = pattern.indexOf("*");
      out.paths.push({
        prefix: star >= 0 ? pattern.slice(0, star) : pattern,
        suffix: star >= 0 ? pattern.slice(star + 1) : "",
        wildcard: star >= 0,
        targets: targets.map((t) => clean(posix.join(pathsBase, t))),
      });
    }
    // longest prefix wins, like TypeScript
    out.paths.sort((a, b) => b.prefix.length - a.prefix.length);
    return out;
  }
  return out;
}

const clean = (p: string) => (p === "." ? "" : p.replace(/^\.\//, "").replace(/\/$/, ""));

/** Resolves an import to a project file, or undefined for packages and files we do not have. */
export function resolveImport(from: string, spec: string, files: Set<string>, aliases: PathAliases): string | undefined {
  const tryPath = (p: string): string | undefined => {
    const base = clean(posix.normalize(p));
    if (files.has(base)) return base;
    // TS ESM style: "./x.js" written for "./x.ts"
    const noExt = base.replace(/\.(c|m)?jsx?$/, "");
    for (const ext of EXTS) if (files.has(noExt + ext)) return noExt + ext;
    for (const ext of EXTS) if (files.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
    return undefined;
  };

  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
    return tryPath(posix.join(dirname(from) === "." ? "" : dirname(from), spec));
  }
  if (spec.startsWith("/")) return tryPath(spec.slice(1));
  for (const a of aliases.paths) {
    if (a.wildcard ? spec.startsWith(a.prefix) && spec.endsWith(a.suffix) && spec.length >= a.prefix.length + a.suffix.length : spec === a.prefix) {
      const middle = a.wildcard ? spec.slice(a.prefix.length, spec.length - a.suffix.length) : "";
      for (const t of a.targets) {
        const hit = tryPath(t.replace("*", middle));
        if (hit) return hit;
      }
    }
  }
  if (aliases.baseUrl !== undefined) return tryPath(posix.join(aliases.baseUrl, spec));
  return undefined;
}
