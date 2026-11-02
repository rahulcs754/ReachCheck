import { describe, expect, it } from "vitest";
import { globToRegExp, parseJsonc } from "../src/files.js";
import { buildGraph, findEntries } from "../src/graph.js";
import { dependencyGraph, directParents, nameFromKey } from "../src/lockfile.js";
import { parseFile } from "../src/parse.js";
import { loadAliases, resolveImport } from "../src/resolve.js";

describe("resolveImport", () => {
  const files = new Set(["src/a.ts", "src/lib/index.tsx", "src/util.ts", "packages/ui/button.tsx"]);
  const aliases = loadAliases((p) =>
    p === "tsconfig.json" ? `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], "@ui/*": ["packages/ui/*"] } } }` : undefined,
  );
  it("relative, index and .js-for-.ts", () => {
    expect(resolveImport("src/a.ts", "./lib", files, aliases)).toBe("src/lib/index.tsx");
    expect(resolveImport("src/lib/index.tsx", "../util.js", files, aliases)).toBe("src/util.ts");
  });
  it("path aliases and baseUrl", () => {
    expect(resolveImport("src/a.ts", "@/util", files, aliases)).toBe("src/util.ts");
    expect(resolveImport("src/a.ts", "@ui/button", files, aliases)).toBe("packages/ui/button.tsx");
    expect(resolveImport("src/a.ts", "src/util", files, aliases)).toBe("src/util.ts");
    expect(resolveImport("src/a.ts", "lodash", files, aliases)).toBeUndefined();
  });
  it("follows a local extends", () => {
    const read = (p: string) =>
      p === "tsconfig.json" ? `{ "extends": "./config/base" }` : p === "config/base.json" ? `{ "compilerOptions": { "baseUrl": "..", "paths": { "~/*": ["src/*"] } } }` : undefined;
    expect(resolveImport("src/a.ts", "~/util", files, loadAliases(read))).toBe("src/util.ts");
  });
});

describe("entries and graph", () => {
  it("uses package.json entries for a library and maps dist back to src", () => {
    const entries = findEntries(["src/index.ts", "src/cli.ts", "src/x.ts"], { packageJson: { main: "dist/index.js", bin: { tool: "dist/cli.js" } } });
    expect(entries.map((e) => e.path)).toEqual(["src/index.ts", "src/cli.ts"]);
  });
  it("adds --entry globs", () => {
    const entries = findEntries(["scripts/seed.ts", "scripts/lib/a.ts"], { extra: ["scripts/*.ts"] });
    expect(entries.map((e) => e.path)).toEqual(["scripts/seed.ts"]);
  });
  it("Vite apps ship common entries to the client", () => {
    const entries = findEntries(["src/main.tsx"], { packageJson: { devDependencies: { vite: "5" } }, browserApp: true });
    expect(entries[0]!.side).toBe("client");
  });
  it("falls back to every non-test file without entries", () => {
    const parsed = [parseFile("lib/a.ts", "export const a = 1"), parseFile("lib/a.test.ts", "")];
    const g = buildGraph(parsed, [], { paths: [] });
    expect(g.fallback).toBe(true);
    expect([...g.reached.keys()]).toEqual(["lib/a.ts"]);
  });
  it("'use server' files stay on the server when a client file imports them", () => {
    const parsed = [parseFile("app/c.tsx", `"use client";\nimport { act } from "./actions";`), parseFile("app/actions.ts", `"use server";\nexport async function act() {}`)];
    const g = buildGraph(parsed, [{ path: "app/c.tsx", side: "server", why: "" }], { paths: [] });
    expect([...g.reached.get("app/actions.ts")!]).toEqual(["server"]);
  });
});

describe("lockfiles", () => {
  it("pnpm v9", () => {
    const g = dependencyGraph(`lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      cheerio: { specifier: 1.0.0, version: 1.0.0 }
    devDependencies:
      jest: { specifier: 29.0.0, version: 29.0.0 }
packages: {}
snapshots:
  cheerio@1.0.0:
    dependencies:
      css-select: 5.0.0
  css-select@5.0.0:
    dependencies:
      nth-check: 2.0.0
  jest@29.0.0:
    dependencies:
      braces: 3.0.0
`);
    expect(directParents(g, "nth-check")).toEqual(["cheerio"]);
    expect(g.direct.get("jest")).toEqual({ dev: true });
  });
  it("yarn v1", () => {
    const g = dependencyGraph(`# yarn lockfile v1

axios@^1.6.0:
  version "1.6.0"
  dependencies:
    follow-redirects "^1.15.0"

"@scope/a@^1.0.0", "@scope/a@^1.1.0":
  version "1.1.0"
  dependencies:
    axios "^1.6.0"
`, { dependencies: { "@scope/a": "^1.0.0" } });
    expect(directParents(g, "follow-redirects")).toEqual(["@scope/a"]);
  });
  it("yarn berry", () => {
    const g = dependencyGraph(`__metadata:
  version: 8

"app@workspace:.":
  version: 0.0.0-use.local
  resolution: "app@workspace:."
  dependencies:
    axios: "npm:^1.6.0"

"axios@npm:^1.6.0":
  version: 1.6.0
  resolution: "axios@npm:1.6.0"
  dependencies:
    follow-redirects: "npm:^1.15.0"
`);
    expect(directParents(g, "follow-redirects")).toEqual(["axios"]);
  });
  it("key names", () => {
    expect(nameFromKey("/@scope/pkg@1.0.0(react@18)")).toBe("@scope/pkg");
    expect(nameFromKey("/pkg/1.0.0")).toBe("pkg");
    expect(nameFromKey(`"lodash@npm:^4.0.0, lodash@npm:^4.1.0"`)).toBe("lodash");
  });
});

describe("helpers", () => {
  it("parses JSON with comments and trailing commas but keeps // in strings", () => {
    expect(parseJsonc(`{ "a": "http://x", // c\n /* b */ "b": [1,], }`)).toEqual({ a: "http://x", b: [1] });
  });
  it("globs", () => {
    expect(globToRegExp("app/**/*.tsx").test("app/page.tsx")).toBe(true);
    expect(globToRegExp("app/**/*.tsx").test("app/a/b/page.tsx")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
  });
});
