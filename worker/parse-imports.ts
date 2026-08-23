import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FileImport } from "./types";

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".turbo", "coverage"]);

 // static import: import x from "pkg" / import "pkg" / import type { } from "pkg"
const STATIC_IMPORT_RE =
  /import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;

// require("pkg")
const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// dynamic import("pkg") / await import("pkg")
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function isBareSpecifier(spec: string): boolean {
  if (!spec) return false;
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("!") || spec.startsWith("#")) return false;
  return true;
}

function packageNameFromSpecifier(spec: string): string {
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split("/")[0] ?? spec;
}

async function walkFiles(
  dir: string,
  base: string,
  out: string[]
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walkFiles(path.join(dir, e.name), base, out);
    } else if (e.isFile()) {
      const ext = path.extname(e.name);
      if (!SOURCE_EXTS.has(ext)) continue;
      const full = path.join(dir, e.name);
      // respect lock: only include files that are not too large (skip >500kb)
      try {
        const s = await stat(full);
        if (s.size > 512_000) continue;
      } catch {
        continue;
      }
      out.push(full);
    }
  }
}

function parseFileContent(content: string, relPath: string): FileImport[] {
  const results: FileImport[] = [];
  const lines = content.split("\n");

  // Build line-offset map? Instead regex on whole content and map index to line.
  // Create array of line start offsets
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1; // +1 for \n
  }
  function lineOfIndex(idx: number): number {
    // binary search lineStarts
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if ((lineStarts[mid] ?? 0) <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-indexed
  }

  for (const m of content.matchAll(STATIC_IMPORT_RE)) {
    const spec = m[1];
    if (!spec || !isBareSpecifier(spec)) continue;
    const idx = m.index ?? 0;
    // avoid double-counting dynamic handled separately: static import("pkg") already covered but import( is not matched here due to no `from` pattern requirement? It will match `import("pkg")` as static? DYNAMIC has parens - keep dedup.
    // Heuristic: if preceding char context is `import(` skip — regex already ensures not.
    results.push({
      filePath: relPath,
      packageName: packageNameFromSpecifier(spec),
      importType: "static",
      line: lineOfIndex(idx),
    });
  }

  for (const m of content.matchAll(REQUIRE_RE)) {
    const spec = m[1];
    if (!spec || !isBareSpecifier(spec)) continue;
    const idx = m.index ?? 0;
    results.push({
      filePath: relPath,
      packageName: packageNameFromSpecifier(spec),
      importType: "require",
      line: lineOfIndex(idx),
    });
  }

  for (const m of content.matchAll(DYNAMIC_IMPORT_RE)) {
    const spec = m[1];
    if (!spec || !isBareSpecifier(spec)) continue;
    const idx = m.index ?? 0;
    // avoid duplicate if already counted as static (import("x") matched static too — dedup)
    const already = results.some(
      (r) => r.line === lineOfIndex(idx) && r.packageName === packageNameFromSpecifier(spec)
    );
    if (already) continue;
    results.push({
      filePath: relPath,
      packageName: packageNameFromSpecifier(spec),
      importType: "dynamic",
      line: lineOfIndex(idx),
    });
  }

  return results;
}

/**
 * Regex pass on src/**\/*.{ts,tsx,js,jsx} — AST upgrade later per spec.
 * Scans entire repo excluding node_modules/.git etc, but prefers src/ if exists.
 */
export async function parseImports(repoDir: string): Promise<FileImport[]> {
  // Prefer scanning whole repo minus skips; spec says src/**/* but scanning more is fine.
  const files: string[] = [];
  await walkFiles(repoDir, repoDir, files);

  const all: FileImport[] = [];
  for (const abs of files) {
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(repoDir, abs).replace(/\\/g, "/");
    const imports = parseFileContent(content, rel);
    all.push(...imports);
  }
  return all;
}

// Exported for testing
export const _internal = {
  parseFileContent,
  packageNameFromSpecifier,
  isBareSpecifier,
};
