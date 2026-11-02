import { describe, expect, it } from "vitest";
import { packageOf, parseFile } from "../src/parse.js";
import { vulnerableCalls, fnName } from "../src/reach.js";

describe("parseFile", () => {
  it("collects every import form", () => {
    const f = parseFile(
      "a.tsx",
      `"use client";
import def, { a as b, type T } from "pkg-a";
import * as ns from "pkg-b";
import type { X } from "pkg-c";
export * from "./local";
export { y } from "pkg-d";
const { c, d: e } = require("pkg-e");
const lazy = await import("pkg-f");
import "pkg-g";
const el = <ns.Widget />;`,
    );
    expect(f.directive).toBe("client");
    expect(f.imports.map((i) => [i.spec, i.kind, i.typeOnly])).toEqual([
      ["pkg-a", "static", false],
      ["pkg-b", "static", false],
      ["pkg-c", "static", true],
      ["./local", "reexport", false],
      ["pkg-d", "reexport", false],
      ["pkg-e", "require", false],
      ["pkg-f", "dynamic", false],
      ["pkg-g", "static", false],
    ]);
    expect(f.imports[0]!.bindings).toEqual([
      { local: "def", imported: "default" },
      { local: "b", imported: "a" },
    ]);
    expect(f.imports[5]!.bindings).toEqual([
      { local: "c", imported: "c" },
      { local: "e", imported: "d" },
    ]);
    expect(f.calls).toContainEqual({ callee: ["ns", "Widget"], line: 10 });
  });

  it("parses .ts files with angle-bracket casts", () => {
    const f = parseFile("a.ts", `import x from "y";\nconst n = <number>x();`);
    expect(f.error).toBeUndefined();
    expect(f.calls).toContainEqual({ callee: ["x"], line: 2 });
  });

  it("maps specifiers to packages", () => {
    expect(packageOf("lodash/template")).toBe("lodash");
    expect(packageOf("@scope/pkg/sub")).toBe("@scope/pkg");
    expect(packageOf("./x")).toBeUndefined();
    expect(packageOf("node:fs")).toBeUndefined();
  });
});

describe("vulnerableCalls", () => {
  const check = (code: string, fns = ["template"]) => {
    const f = parseFile("f.ts", code);
    const use = f.imports.map((i) => ({ file: "f.ts", line: i.line, spec: i.spec, bindings: i.bindings }))[0]!;
    return vulnerableCalls(use, "lodash", fns.map(fnName), f);
  };

  it("named import", () => expect(check(`import { template } from "lodash";\ntemplate("x");`)).toEqual(["f.ts:2"]));
  it("renamed import", () => expect(check(`import { template as t } from "lodash";\nt("x");`)).toEqual(["f.ts:2"]));
  it("default member call", () => expect(check(`import _ from "lodash";\n_.template("x");`)).toEqual(["f.ts:2"]));
  it("namespace member call", () => expect(check(`import * as L from "lodash";\nL["template"]("x");`)).toEqual(["f.ts:2"]));
  it("subpath import", () => expect(check(`import t from "lodash/template";\nt("x");`)).toEqual(["f.ts:2"]));
  it("require destructure", () => expect(check(`const { template } = require("lodash");\ntemplate("x");`)).toEqual(["f.ts:2"]));
  it("other function only", () => expect(check(`import _ from "lodash";\n_.debounce(() => 1);\nfunction template() {}\ntemplate();`)).toEqual([]));
  it("advisory name forms", () => expect(["lodash.template", "_.template", "template()", "lodash#template"].map(fnName)).toEqual(["template", "template", "template", "template"]));
});

describe("package that is the function", () => {
  it("default import of a function package counts as the function", () => {
    const f = parseFile("f.ts", `import clsx from "clsx";\nclsx("a");`);
    const use = { file: "f.ts", line: 1, spec: "clsx", bindings: f.imports[0]!.bindings };
    expect(vulnerableCalls(use, "clsx", ["clsx"], f)).toEqual(["f.ts:2"]);
  });
  it("named import of the same name still works", () => {
    const f = parseFile("f.ts", `import { marked } from "marked";\nmarked("a");`);
    const use = { file: "f.ts", line: 1, spec: "marked", bindings: f.imports[0]!.bindings };
    expect(vulnerableCalls(use, "marked", ["marked"], f)).toEqual(["f.ts:2"]);
  });
});
