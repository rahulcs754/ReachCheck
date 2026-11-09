#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { fetchAlerts, parseAlertsFile } from "./alerts.js";
import { analyze } from "./analyze.js";
import { chainTo } from "./graph.js";
import { failure, renderJson, renderMarkdown } from "./report.js";
import { renderVex } from "./vex.js";

const HELP = `ReachCheck: rank npm Dependabot alerts by real reachability.

Usage:
  reachcheck --repo owner/name            read open alerts from GitHub (needs GITHUB_TOKEN)
  reachcheck --alerts-file alerts.json    read alerts from a saved API response
  reachcheck why <file>                   show the import chain from an entry point to a file

Options:
  --root <dir>         project folder (default: .)
  --entry <glob>       extra entry point, e.g. "scripts/*.ts" (repeatable)
  --format <f>         md (default), json or vex (OpenVEX)
  --out <file>         write the report to a file instead of stdout
  --product <id>       product id for VEX (default: pkg:github/<repo> or pkg:npm/<name>)
  --fail-on <level>    exit 1 when a reachable alert is at this severity or above: critical, high, medium, low
  --api-url <url>      GitHub API URL (GitHub Enterprise)
`;

interface Args {
  _: string[];
  entry: string[];
  [k: string]: string | string[] | boolean | undefined;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], entry: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") out.help = true;
    else if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2) as [string, string | undefined];
      const v = inline ?? argv[++i];
      if (v === undefined) throw new Error(`--${k} needs a value`);
      if (k === "entry") out.entry.push(v);
      else out[k] = v;
    } else out._.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : undefined);
  if (args.help) return void process.stdout.write(HELP);
  const root = str("root") ?? ".";

  if (args._[0] === "why") {
    const target = args._[1];
    if (!target) throw new Error("Usage: reachcheck why <file>");
    const { graph } = analyze([], { root, entries: args.entry });
    if (!graph.reached.has(target)) {
      process.stdout.write(`${target} is not reached from any entry point (${graph.entries.length} entries).\n`);
      process.exitCode = 1;
      return;
    }
    const sides = [...graph.reached.get(target)!].join(", ");
    process.stdout.write(`${chainTo(graph, target).join("\n  → ")}\n\nRuns on: ${sides}\n`);
    return;
  }

  const repo = str("repo") ?? process.env.GITHUB_REPOSITORY;
  let alerts;
  if (str("alerts-file")) alerts = parseAlertsFile(readFileSync(str("alerts-file")!, "utf8"));
  else {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (!repo || !token) throw new Error("Pass --alerts-file, or --repo owner/name with GITHUB_TOKEN set. Run with --help for more.");
    const [owner, name] = repo.split("/") as [string, string];
    alerts = await fetchAlerts({ token, owner, repo: name, apiUrl: str("api-url") });
  }

  const { results, meta } = analyze(alerts, { root, entries: args.entry });
  const format = str("format") ?? "md";
  let text: string;
  if (format === "json") text = renderJson(results, meta);
  else if (format === "vex") {
    let pkgName: string | undefined;
    try {
      pkgName = JSON.parse(readFileSync(`${root}/package.json`, "utf8")).name;
    } catch {
      pkgName = undefined;
    }
    const product = str("product") ?? (repo ? `pkg:github/${repo}` : pkgName ? `pkg:npm/${pkgName}` : "pkg:generic/app");
    text = renderVex(results, { product });
  } else if (format === "md") text = renderMarkdown(results, meta);
  else throw new Error(`Unknown --format ${format}: use md, json or vex`);

  if (str("out")) writeFileSync(str("out")!, `${text}\n`);
  else process.stdout.write(`${text}\n`);

  const fail = failure(results, str("fail-on") ?? "none");
  if (fail) {
    process.stderr.write(`${fail}\n`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  process.stderr.write(`reachcheck: ${(e as Error).message}\n`);
  process.exitCode = 2;
});
