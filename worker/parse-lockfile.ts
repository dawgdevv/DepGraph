import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PackageRecord, ParseLockfileResult } from "./types";

function extractName(lockKey: string): string | null {
  if (lockKey === "") return null; // root
  // lockKey like "node_modules/foo" or "node_modules/foo/node_modules/bar"
  const parts = lockKey.split("node_modules/");
  const last = parts[parts.length - 1];
  if (!last) return null;
  // scoped package: "@scope/name" contains slash, already isolated as last segment
  // for nested scoped, still last segment may be "@scope/name"
  return last.replace(/\/$/, "");
}

function toId(name: string, version: string, lockKey: string): string {
  if (version) return `${name}@${version}`;
  return lockKey || name;
}

export async function parseLockfile(
  repoDir: string
): Promise<ParseLockfileResult> {
  const pkgJsonRaw = await readFile(path.join(repoDir, "package.json"), "utf8");
  const lockRaw = await readFile(
    path.join(repoDir, "package-lock.json"),
    "utf8"
  );

  let pkgJson: Record<string, unknown>;
  let lock: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(pkgJsonRaw) as Record<string, unknown>;
  } catch {
    throw new Error("package.json is not valid JSON.");
  }
  try {
    lock = JSON.parse(lockRaw) as Record<string, unknown>;
  } catch {
    throw new Error("package-lock.json is not valid JSON.");
  }

  // Direct deps = keys of dependencies + devDependencies + optional + peer (conservative: include deps + devDeps)
  const directNames = new Set<string>();
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    const v = pkgJson[field];
    if (v && typeof v === "object") {
      for (const k of Object.keys(v as Record<string, unknown>)) directNames.add(k);
    }
  }

  const packages: PackageRecord[] = [];

  const packagesMap = lock["packages"] as
    | Record<string, { version?: string; dependencies?: Record<string, string>; dev?: boolean; optional?: boolean }>
    | undefined;

  if (packagesMap && typeof packagesMap === "object") {
    // lockfileVersion 2/3 : packages map
    for (const [key, entry] of Object.entries(packagesMap)) {
      if (key === "") continue; // root
      if (!entry || typeof entry !== "object") continue;
      const name = extractName(key);
      if (!name) continue;
      const version = (entry.version as string | undefined) ?? "0.0.0";
      const deps = entry.dependencies
        ? Object.keys(entry.dependencies)
        : [];
      packages.push({
        id: toId(name, version, key),
        name,
        version,
        isDirect: directNames.has(name),
        dependencies: deps,
        lockKey: key,
      });
    }
  } else {
    // lockfileVersion 1 fallback: dependencies map
    const depsMap = lock["dependencies"] as
      | Record<string, { version?: string; requires?: Record<string, string>; dependencies?: Record<string, unknown> }>
      | undefined;
    if (depsMap) {
      const walk = (
        map: Record<string, { version?: string; requires?: Record<string, string>; dependencies?: Record<string, unknown> }>,
        prefix: string
      ) => {
        for (const [name, entry] of Object.entries(map)) {
          const version = (entry.version as string | undefined) ?? "0.0.0";
          const deps = entry.requires ? Object.keys(entry.requires) : [];
          const key = prefix ? `${prefix}/node_modules/${name}` : `node_modules/${name}`;
          packages.push({
            id: toId(name, version, key),
            name,
            version,
            isDirect: directNames.has(name),
            dependencies: deps,
            lockKey: key,
          });
          if (entry.dependencies && typeof entry.dependencies === "object") {
            walk(
              entry.dependencies as Record<string, { version?: string; requires?: Record<string, string>; dependencies?: Record<string, unknown> }>,
              key
            );
          }
        }
      };
      walk(depsMap, "");
    }
  }

  // Deduplicate by id - keep first, merge dependencies union if duplicates with different lockKeys but same name@version
  const byId = new Map<string, PackageRecord>();
  for (const p of packages) {
    const existing = byId.get(p.id);
    if (!existing) {
      byId.set(p.id, p);
    } else {
      // merge deps
      const merged = new Set([...existing.dependencies, ...p.dependencies]);
      existing.dependencies = [...merged];
      // isDirect true if any instance is direct
      existing.isDirect = existing.isDirect || p.isDirect;
    }
  }

  const deduped = [...byId.values()];
  const directCount = deduped.filter((p) => p.isDirect).length;
  const transitiveCount = deduped.length - directCount;

  return {
    packages: deduped,
    totalCount: deduped.length,
    directCount,
    transitiveCount,
  };
}
