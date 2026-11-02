import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAlertsFile } from "../src/alerts.js";
import { analyze } from "../src/analyze.js";
import { chainTo } from "../src/graph.js";
import { failure, renderMarkdown } from "../src/report.js";
import { renderVex } from "../src/vex.js";

const root = "test/fixtures/next-app";
const alerts = parseAlertsFile(readFileSync(`${root}/alerts.json`, "utf8"));
const { results, meta, graph } = analyze(alerts, { root });
const by = (pkg: string) => results.find((r) => r.alert.package === pkg)!;

describe("fixture Next.js app", () => {
  it("skips dismissed alerts", () => {
    expect(alerts).toHaveLength(10);
    expect(alerts.find((a) => a.package === "react")).toBeUndefined();
  });

  it("finds Next.js entry points", () => {
    expect(graph.entries.map((e) => e.path).sort()).toEqual(["src/app/api/fetch/route.ts", "src/app/cart/page.tsx", "src/app/layout.tsx"]);
    expect(meta.fallback).toBe(false);
  });

  it("follows a client boundary into files without 'use client'", () => {
    expect([...graph.reached.get("src/components/note.ts")!]).toEqual(["client"]);
    expect(chainTo(graph, "src/components/note.ts")).toEqual(["src/app/cart/page.tsx", "src/components/CartView.tsx", "src/components/note.ts"]);
  });

  it("resolves tsconfig path aliases", () => {
    expect(graph.reached.has("src/lib/format.ts")).toBe(true);
  });

  it("gives each alert the right verdict", () => {
    expect(Object.fromEntries(results.map((r) => [r.alert.package, r.verdict]))).toEqual({
      marked: "called",
      lodash: "called",
      "follow-redirects": "via-dependency",
      axios: "imported-safe",
      "left-pad": "dead-code",
      "nth-check": "not-imported",
      zod: "not-imported",
      qs: "test-only",
      minimist: "dev-only",
      braces: "dev-only",
    });
  });

  it("shows where the vulnerable function is called and on which side", () => {
    expect(by("lodash").locations).toEqual(["src/lib/format.ts:3"]);
    expect(by("lodash").sides).toEqual(["server"]);
    expect(by("marked").sides).toEqual(["client"]);
    // client exposure sorts first among equal verdicts
    expect(results[0]!.alert.package).toBe("marked");
  });

  it("ignores a local function that shares the vulnerable name", () => {
    expect(by("axios").evidence).toContain("not used");
  });

  it("ignores type-only imports", () => {
    expect(by("zod").verdict).toBe("not-imported");
  });

  it("renders a report and fails at the right level", () => {
    const md = renderMarkdown(results, meta);
    expect(md).toContain("**3** of 10 open alerts reach shipped code (**1** in the browser bundle)");
    expect(md).toContain("src/app/cart/page.tsx → src/components/CartView.tsx → src/components/note.ts");
    expect(failure(results, "high")).toBe("2 reachable Dependabot alert(s) at high or above: marked, lodash");
    expect(failure(results, "critical")).toBeUndefined();
    expect(failure(results, "none")).toBeUndefined();
  });

  it("writes OpenVEX statements", () => {
    const vex = JSON.parse(renderVex(results, { product: "pkg:github/acme/shop", timestamp: "2026-11-02T00:00:00Z" }));
    expect(vex["@context"]).toBe("https://openvex.dev/ns/v0.2.0");
    const st = (pkg: string) => vex.statements.find((s: any) => s.products[0].subcomponents[0]["@id"] === `pkg:npm/${pkg}`);
    expect(st("lodash")).toMatchObject({ status: "affected", vulnerability: { name: "GHSA-35jh-r3h4-6jhm", aliases: ["CVE-2021-23337"] } });
    expect(st("axios")).toMatchObject({ status: "not_affected", justification: "vulnerable_code_not_in_execute_path" });
    expect(st("minimist")).toMatchObject({ status: "not_affected", justification: "component_not_present" });
  });
});
