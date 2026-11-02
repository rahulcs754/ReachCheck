import type { Alert } from "./types.js";

export interface FetchOptions {
  token: string;
  owner: string;
  repo: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Open npm Dependabot alerts for a repo, with vulnerable function names from each advisory. */
export async function fetchAlerts(opts: FetchOptions): Promise<Alert[]> {
  const api = (opts.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  const f = opts.fetchImpl ?? fetch;
  const get = async (url: string) => {
    const res = await f(url, {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${opts.token}`, "x-github-api-version": "2022-11-28" },
    });
    if (!res.ok) {
      const hint =
        res.status === 403 || res.status === 404
          ? " The token needs Dependabot alerts read access (workflow permission `security-events: read`), and Dependabot alerts must be on for the repo."
          : "";
      throw new Error(`GitHub API ${new URL(url).pathname} returned ${res.status}.${hint}`);
    }
    return res.json() as Promise<any>;
  };

  const raw: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const batch = (await get(`${api}/repos/${opts.owner}/${opts.repo}/dependabot/alerts?state=open&ecosystem=npm&per_page=100&page=${page}`)) as any[];
    raw.push(...batch);
    if (batch.length < 100) break;
  }

  // Dependabot alerts do not include vulnerable_functions; the global advisory does.
  const cache = new Map<string, Promise<Record<string, string[]>>>();
  const fnsFor = (ghsa: string) => {
    if (!ghsa) return Promise.resolve({} as Record<string, string[]>);
    let p = cache.get(ghsa);
    if (!p) {
      p = get(`${api}/advisories/${ghsa}`)
        .then((adv) => {
          const out: Record<string, string[]> = {};
          for (const v of adv.vulnerabilities ?? []) if (v.package?.name) out[v.package.name] = v.vulnerable_functions ?? [];
          return out;
        })
        .catch(() => ({})); // function names are a bonus; the alert still counts
      cache.set(ghsa, p);
    }
    return p;
  };
  return Promise.all(raw.map(async (a) => toAlert(a, (await fnsFor(a.security_advisory?.ghsa_id ?? ""))[a.dependency?.package?.name] ?? [])));
}

/** Maps one Dependabot alert (REST API shape) or an already-simple alert object to our shape. */
export function toAlert(a: any, functions: string[] = []): Alert {
  if (typeof a.package === "string") {
    return { number: 0, severity: "unknown", ghsa: "", summary: "", ...a, functions: a.functions ?? a.vulnerable_functions ?? functions };
  }
  return {
    number: a.number,
    package: a.dependency?.package?.name ?? a.security_vulnerability?.package?.name,
    severity: a.security_vulnerability?.severity ?? a.security_advisory?.severity ?? "unknown",
    ghsa: a.security_advisory?.ghsa_id ?? "",
    cve: a.security_advisory?.cve_id ?? undefined,
    summary: a.security_advisory?.summary ?? "",
    manifest: a.dependency?.manifest_path,
    scope: a.dependency?.scope ?? null,
    vulnerableRange: a.security_vulnerability?.vulnerable_version_range,
    patched: a.security_vulnerability?.first_patched_version?.identifier,
    functions: a.vulnerable_functions ?? functions,
    url: a.html_url,
  };
}

/** Reads alerts from a saved file: the API array, `{ alerts: [...] }`, or simple `{ package, severity, functions }` objects. */
export function parseAlertsFile(text: string): Alert[] {
  const raw = JSON.parse(text);
  const items: any[] = Array.isArray(raw) ? raw : (raw.alerts ?? []);
  return items
    .filter((a) => (a.state ?? "open") === "open")
    .filter((a) => (a.dependency?.package?.ecosystem ?? a.ecosystem ?? "npm") === "npm")
    .map((a, i) => {
      const alert = toAlert(a);
      return alert.number ? alert : { ...alert, number: i + 1 };
    })
    .filter((a) => a.package);
}
