# ReachCheck

**Which of your Dependabot alerts can actually hurt you?**

ReachCheck reads your open npm Dependabot alerts and follows your real module graph, from your app's entry points (Next.js pages, layouts and routes, `main`/`bin`, `src/main.tsx`), to tell you for each alert whether shipped code really uses it, and whether it ends up in the **browser bundle** or only on the **server**.

```
| Verdict       | Side   | Alert               | Package | Severity | Why                                                    |
| 🔴 Called     | client | #2 ReDoS in marked  | marked  | high     | Vulnerable function `marked` used at src/components/note.ts:4
|               |        |                     |         |          | src/app/cart/page.tsx → src/components/CartView.tsx → src/components/note.ts
| 🟡 Function not used | server | #3 ...       | axios   | high     | Loaded by src/app/api/fetch/route.ts, but `formToJSON` is not used there
| ⚪ Dead code only |    | #5 ...              | left-pad| low      | Imported only in files no entry point reaches: src/legacy/old.ts
```

> Status: v0.1 MVP. CLI + GitHub Action. npm only (npm, pnpm and Yarn lockfiles).

## Why

- Most Dependabot alerts are for packages that never run in production, so teams learn to ignore all of them, including the real ones.
- Paid reachability tools are heavy or expensive for small teams.
- In Next.js the same package can be server-only or shipped to every visitor's browser. A file without `"use client"` is still client code when a client component imports it. ReachCheck follows that.

## Verdicts

| Verdict | Meaning | Priority |
| --- | --- | --- |
| 🔴 Called | The advisory names a vulnerable function and shipped code uses it (file:line) | Fix now |
| 🟠 Reachable | Shipped code loads the package; the advisory names no function | Fix soon |
| 🟠 Via dependency | Transitive; a direct dependency that shipped code loads pulls it in | Fix soon |
| ❔ Unknown | Transitive, and there is no lockfile to follow | Check |
| 🟡 Function not used | Shipped code loads the package but never touches the vulnerable function | Lower |
| ⚪ Dead code only | Only imported by files no entry point reaches (delete them!) | Low |
| ⚪ Not imported | In the lockfile, never loaded by your code | Low |
| ⚪ Tests only / Dev only | Does not ship to production | Low |

Within a verdict, browser-bundle alerts come first, then by severity.

## Use it as a GitHub Action

```yaml
# .github/workflows/reachcheck.yml
name: ReachCheck
on:
  schedule:
    - cron: "0 3 * * 1" # every Monday
  workflow_dispatch:

permissions:
  contents: read
  security-events: read # read Dependabot alerts

jobs:
  reachcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: rahulcs754/ReachCheck@main
        with:
          fail-on: high # optional: fail when a reachable alert is high or critical
          vex-file: reachcheck.vex.json # optional: OpenVEX output
```

The report goes to the job summary. A fuller example with PR runs and the VEX upload is in [examples/reachcheck.yml](examples/reachcheck.yml).

| Input | Default | What it does |
| --- | --- | --- |
| `github-token` | `github.token` | Reads Dependabot alerts (needs `security-events: read`) |
| `working-directory` | `.` | Project folder to scan; use the app folder in a monorepo |
| `entries` | | Extra entry point globs, e.g. `scripts/*.ts` |
| `fail-on` | `none` | Fail when a reachable alert is at `critical`, `high`, `medium` or `low` or above |
| `vex-file` | | Write an [OpenVEX](https://openvex.dev) document here |
| `alerts-file` | | Read alerts from a JSON file instead of the API |

Outputs: `alerts`, `reachable`, `called`, `client` (reachable alerts in the browser bundle), `report` (JSON), `vex-file`.

## Use it from the command line

```bash
npm ci && npm run build

# open alerts straight from GitHub
GITHUB_TOKEN=$(gh auth token) node dist/cli.js --repo owner/name --root ../my-app

# or from a saved API response
gh api "repos/owner/name/dependabot/alerts?state=open&per_page=100" > alerts.json
node dist/cli.js --alerts-file alerts.json --root ../my-app

# other formats
node dist/cli.js --alerts-file alerts.json --format json
node dist/cli.js --alerts-file alerts.json --format vex --out reachcheck.vex.json

# why does this file ship? (import chain from an entry point, and client/server side)
node dist/cli.js why src/components/note.ts --root ../my-app
```

The alerts file can also be a simple list: `[{ "package": "lodash", "severity": "high", "functions": ["template"] }]`.

## How it works

1. Parses every JS/TS/JSX/TSX file with Babel (imports, `require`, dynamic `import()`, re-exports, calls, JSX).
2. Finds entry points: Next.js `app/` and `pages/` files, `middleware`, `instrumentation`, `next.config`, `package.json` `main`/`module`/`bin`/`exports` (mapped back from `dist/` to `src/`), common files like `src/main.tsx`, plus your `entries`.
3. Resolves local imports, including `tsconfig.json`/`jsconfig.json` `paths` and `baseUrl`, and walks the graph. App Router files start on the server; `"use client"` switches to the browser for everything below it; `"use server"` switches back. Type-only imports are skipped.
4. For each alert, checks shipped imports of the package. When the advisory lists vulnerable functions, it tracks bindings: `import { template }`, `import _ from` + `_.template()`, `import * as L`, `lodash/template` subpaths, `require` destructuring, and packages that are the function (`import clsx from "clsx"`). A local function with the same name does not count.
5. Uses the lockfile to explain transitive alerts and to spot dev-only ones.

## Limits

- Static analysis: no runtime tracing. Dynamic `require(variable)` and framework magic outside the list above are not followed.
- Transitive alerts stop at "via dependency": it does not yet check whether the parent package calls the vulnerable function.
- Variable shadowing is not tracked (a local variable with the same name as an import can cause a false "called").
- If no entry point is found, every non-test file counts as shipped (the report says so).

## ReachCheck vs DepGate

[DepGate](https://github.com/rahulcs754/depgate) blocks risky **new** packages in PRs and has a quick ReachCheck mode (import scan). This repo is the deeper engine: entry-point graph, dead-code detection, client-bundle propagation, binding-aware calls, and OpenVEX.

## Develop

```bash
npm ci
npm test        # Vitest, fixture Next.js app in test/fixtures (no network)
npm run lint    # tsc --noEmit
npm run build   # dist/ (commit it: the Action runs dist/index.js)
```

## License

MIT
