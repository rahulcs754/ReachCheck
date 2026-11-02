# MVP plan

## Goal

A CLI and GitHub Action that ranks open npm Dependabot alerts by real reachability, with evidence.

## Scope (v0.1)

- [x] Parse JS/TS/JSX/TSX with `@babel/parser`; collect imports, re-exports, `require`, dynamic `import()`
- [x] Resolve relative imports and `tsconfig.json` `paths`/`baseUrl` aliases
- [x] Entry points: Next.js `app/` and `pages/` routes, `middleware`, `instrumentation`, `package.json` `main`/`bin`/`exports`, common `src/index` files, plus `--entry`
- [x] Module graph walk from entries; mark files client, server or both (`"use client"` propagates)
- [x] Binding-aware vulnerable-function calls (named, default, namespace, member, subpath imports)
- [x] Lockfile graph (npm, pnpm, yarn v1) to explain transitive alerts
- [x] Verdicts: called, reachable, via-dependency, imported-safe, dead-code, test-only, dev-only, not-imported, unknown
- [x] Alerts from the GitHub API (`security-events: read`) or a saved JSON file
- [x] Output: Markdown table, JSON, OpenVEX
- [x] GitHub Action: job summary, outputs, `fail-on`
- [x] Tests on a fixture Next.js app; CI

## Later

- Follow calls inside `node_modules` (does the parent package call the vulnerable function?)
- Opt-in: dismiss "not used" alerts through the API, with a comment
- PR mode: only alerts whose reach changed in this PR
- Other ecosystems
