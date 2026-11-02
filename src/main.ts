import { readFileSync, writeFileSync } from "node:fs";
import * as core from "@actions/core";
import { fetchAlerts, parseAlertsFile } from "./alerts.js";
import { analyze } from "./analyze.js";
import { isReachable } from "./reach.js";
import { failure, renderMarkdown, summarize } from "./report.js";
import { renderVex } from "./vex.js";

async function run() {
  const token = core.getInput("github-token");
  const repoInput = core.getInput("repository") || process.env.GITHUB_REPOSITORY || "";
  const [owner, repo] = repoInput.split("/") as [string, string];
  const root = core.getInput("working-directory") || ".";
  const entries = core
    .getInput("entries")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const alertsFile = core.getInput("alerts-file");

  let alerts;
  try {
    alerts = alertsFile
      ? parseAlertsFile(readFileSync(alertsFile, "utf8"))
      : await fetchAlerts({ token, owner, repo, apiUrl: process.env.GITHUB_API_URL });
  } catch (e) {
    core.setFailed(`Could not read Dependabot alerts: ${(e as Error).message}`);
    return;
  }

  const { results, meta } = analyze(alerts, { root, entries });
  const md = renderMarkdown(results, meta);
  await core.summary.addRaw(md).write();
  core.info(md);

  const counts = summarize(results);
  core.setOutput("alerts", String(results.length));
  core.setOutput("reachable", String(results.filter(isReachable).length));
  core.setOutput("called", String(counts.called));
  core.setOutput("client", String(results.filter((r) => isReachable(r) && r.sides.includes("client")).length));
  core.setOutput("report", JSON.stringify(results.map((r) => ({ number: r.alert.number, package: r.alert.package, severity: r.alert.severity, verdict: r.verdict, sides: r.sides }))));

  const vexFile = core.getInput("vex-file");
  if (vexFile) {
    writeFileSync(vexFile, `${renderVex(results, { product: `pkg:github/${owner}/${repo}` })}\n`);
    core.setOutput("vex-file", vexFile);
  }

  const fail = failure(results, core.getInput("fail-on") || "none");
  if (fail) core.setFailed(fail);
}

run().catch((e) => core.setFailed((e as Error).message));
