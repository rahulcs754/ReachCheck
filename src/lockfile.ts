import { parse as parseYaml } from "yaml";

export const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"] as const;

export interface DepGraph {
  /** Direct dependencies of the project (all workspaces), with whether they are dev-only. */
  direct: Map<string, { dev: boolean }>;
  /** child -> packages that depend on it. */
  parents: Map<string, Set<string>>;
  /** False when the lockfile gave us no dependency edges. */
  known: boolean;
}

const addEdge = (g: DepGraph, parent: string, child: string) => {
  if (parent === child) return;
  const set = g.parents.get(child) ?? new Set<string>();
  set.add(parent);
  g.parents.set(child, set);
  g.known = true;
};

/** "/name@1.0.0(peer@1)" or "/name/1.0.0" or "name@npm:1.0.0" -> "name". */
export function nameFromKey(key: string): string {
  const id = key.replace(/^\//, "").replace(/\(.*$/, "").split(",")[0]!.trim().replace(/^"|"$/g, "");
  const at = id.indexOf("@", 1);
  if (at > 0) return id.slice(0, at);
  const parts = id.split("/"); // pnpm v5 "/name/1.0.0" or "/@scope/name/1.0.0"
  return id.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/** Dependency edges from package-lock.json, pnpm-lock.yaml or yarn.lock (v1 or Berry). `packageJson` fills in direct deps where the lockfile lacks them. */
export function dependencyGraph(lockText: string | undefined, packageJson?: any): DepGraph {
  const g: DepGraph = { direct: new Map(), parents: new Map(), known: false };
  const addDirect = (deps: Record<string, unknown> | undefined, dev: boolean) => {
    for (const name of Object.keys(deps ?? {})) {
      const prev = g.direct.get(name);
      g.direct.set(name, { dev: prev ? prev.dev && dev : dev });
    }
  };
  if (packageJson) {
    addDirect(packageJson.dependencies, false);
    addDirect(packageJson.optionalDependencies, false);
    addDirect(packageJson.peerDependencies, false);
    addDirect(packageJson.devDependencies, true);
  }
  if (!lockText) return g;
  const trimmed = lockText.trimStart();

  if (trimmed.startsWith("{")) {
    const raw = JSON.parse(lockText) as { packages?: Record<string, Record<string, any>> };
    for (const [path, info] of Object.entries(raw.packages ?? {})) {
      const idx = path.lastIndexOf("node_modules/");
      if (idx === -1) {
        // the root or a workspace folder
        addDirect(info.dependencies, false);
        addDirect(info.optionalDependencies, false);
        addDirect(info.devDependencies, true);
        continue;
      }
      const name = info.name ?? path.slice(idx + "node_modules/".length);
      for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
        for (const child of Object.keys(info[field] ?? {})) addEdge(g, name, child);
      }
    }
    return g;
  }

  if (/^lockfileVersion:/m.test(lockText)) {
    const raw = (parseYaml(lockText) ?? {}) as Record<string, any>;
    const importers = raw.importers ?? { ".": raw };
    for (const imp of Object.values<Record<string, any>>(importers)) {
      addDirect(imp.dependencies, false);
      addDirect(imp.optionalDependencies, false);
      addDirect(imp.devDependencies, true);
    }
    for (const section of [raw.packages, raw.snapshots]) {
      for (const [key, info] of Object.entries<Record<string, any>>(section ?? {})) {
        const name = nameFromKey(key);
        for (const field of ["dependencies", "optionalDependencies"]) {
          for (const child of Object.keys(info?.[field] ?? {})) addEdge(g, name, child);
        }
      }
    }
    return g;
  }

  if (/^__metadata:/m.test(lockText)) {
    // Yarn Berry: YAML, keys like "lodash@npm:^4.17.0, lodash@npm:^4.17.21"
    const raw = (parseYaml(lockText) ?? {}) as Record<string, any>;
    for (const [key, info] of Object.entries<Record<string, any>>(raw)) {
      if (key === "__metadata") continue;
      const name = nameFromKey(key);
      const isWorkspace = String(info?.resolution ?? key).includes("@workspace:");
      for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
        for (const child of Object.keys(info?.[field] ?? {})) {
          if (isWorkspace) {
            if (!g.direct.has(child)) g.direct.set(child, { dev: false });
          } else addEdge(g, name, child);
        }
      }
    }
    return g;
  }

  if (trimmed.includes("# yarn lockfile v1")) {
    let name: string | undefined;
    let inDeps = false;
    for (const line of lockText.split(/\r?\n/)) {
      if (!line.trim() || line.startsWith("#")) continue;
      if (!line.startsWith(" ")) {
        name = nameFromKey(line.replace(/:$/, ""));
        inDeps = false;
      } else if (/^ {2}\S/.test(line)) {
        inDeps = /^ {2}(optionalD|d)ependencies:/.test(line);
      } else if (inDeps && name && /^ {4}\S/.test(line)) {
        addEdge(g, name, line.trim().split(/\s+/)[0]!.replace(/^"|"$/g, ""));
      }
    }
  }
  return g;
}

/** Direct dependencies that pull `name` in, walking up the graph. */
export function directParents(g: DepGraph, name: string): string[] {
  const seen = new Set<string>([name]);
  const queue = [name];
  const found = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!;
    for (const p of g.parents.get(cur) ?? []) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (g.direct.has(p)) found.add(p);
      queue.push(p);
    }
  }
  return [...found].sort();
}
