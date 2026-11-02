# Research notes

## Problem

- Dependabot opens alerts for every vulnerable version in the lockfile. Most are transitive or dev-only and never run in production.
- Alert fatigue: teams ignore the whole list. The few alerts that really reach code get missed.
- Commercial tools (Snyk, Endor Labs, Socket, Semgrep Supply Chain) offer reachability, but they are paid, heavy, or need code upload.
- GitHub advisories sometimes list `vulnerable_functions`. Few free tools use that field for npm.

## Gap for npm and Next.js

- Import-level checks say "lodash is imported somewhere", but not whether that file ships. Files that are imported by nothing still count.
- In Next.js the same package can be server-only (safe from browser attacks) or in the client bundle. A file without `"use client"` is still client code when a client component imports it.
- Regex function matching (`template(`) has false positives: any local function with the same name matches.

## Approach

- Parse every JS/TS file with a real parser (Babel, TypeScript + JSX).
- Build the module graph from real entry points and resolve relative paths and `tsconfig` path aliases (`@/...`).
- Track client/server from `"use client"` boundaries through the graph.
- Track bindings: `import { template } from "lodash"`, `import _ from "lodash"` then `_.template(...)`, and `lodash/template` subpath imports.
- Use the lockfile to find which direct dependency pulls in a transitive package.
- Output Markdown, JSON, and OpenVEX.

## Relation to DepGate

DepGate has a lighter ReachCheck mode (import scan + regex). This repo is the deeper standalone engine: entry-point graph, dead-code detection, client-bundle propagation, binding-aware calls, and VEX output. DepGate can later use it as a library.
