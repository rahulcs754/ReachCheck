# ReachCheck

**Which of your Dependabot alerts can actually hurt you?**

ReachCheck reads your open npm Dependabot alerts and follows your real module graph, from your app's entry points (Next.js pages, routes, layouts, `main`/`bin`), to tell you for each alert:

- 🔴 **Called**: the vulnerable function is called from code that ships (file and line shown)
- 🟠 **Reachable**: the package is loaded by code that ships, on the client, the server, or both
- 🟡 **Imported, function not used**: loaded, but the vulnerable function is never touched
- ⚪ **Dead code / tests / dev only / not imported**: lower priority

It can also write an [OpenVEX](https://openvex.dev) file so the "not affected" verdicts are recorded with a reason.

> Status: planning. The MVP is being built in a pull request. See [docs/MVP-PLAN.md](docs/MVP-PLAN.md) and [docs/RESEARCH.md](docs/RESEARCH.md).

## Why

- Most Dependabot alerts are for packages that never run in production, so teams learn to ignore all of them, including the real ones.
- Paid reachability (Snyk, Endor Labs, Socket) is heavy or expensive for small teams. GitHub's own reachability does not cover npm call paths.
- Next.js makes it worse: the same package can be harmless on the server and exposed in the browser bundle. ReachCheck tells you which side.

## License

MIT
