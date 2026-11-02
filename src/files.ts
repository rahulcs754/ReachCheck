import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface SourceFile {
  path: string;
  text: string;
}

export const CODE = /\.(c|m)?[jt]sx?$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", "coverage", "vendor", ".turbo", ".vercel", ".output"]);
const TEST = /(^|\/)(__tests__|__mocks__|__fixtures__|tests?|e2e|cypress|playwright|fixtures|stories)\/|\.(test|spec|stories|cy|e2e)\.[cm]?[jt]sx?$/;

export const isTestFile = (p: string) => TEST.test(p);

/** All JS/TS source files under `root`, skipping node_modules, build output and .d.ts files. Paths use "/". */
export function readSources(root = ".", maxFiles = 20000): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (out.length >= maxFiles) return;
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) walk(full);
      else if (CODE.test(name) && !/\.d\.[cm]?ts$/.test(name) && st.size < 2_000_000) {
        out.push({ path: relative(root, full).split("\\").join("/"), text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(root);
  return out;
}

/** Reads a text file under root, or undefined. */
export function readOptional(root: string, path: string): string | undefined {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return undefined;
  }
}

/** Parses JSON that may contain comments and trailing commas (tsconfig.json). */
export function parseJsonc(text: string): any {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** Simple glob ("app/**\/*.tsx", "src/*.ts") to RegExp. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re.replace(/^\.\//, "")}$`);
}
