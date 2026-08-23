import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { FileImport } from "./types";

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".turbo", "coverage"]);

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

async function walkFiles(dir: string, out: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walkFiles(path.join(dir, e.name), out);
    } else if (e.isFile()) {
      const ext = path.extname(e.name);
      if (!SOURCE_EXTS.has(ext)) continue;
      const full = path.join(dir, e.name);
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

// --- regex fallback (kept for files that fail to parse) ---
const STATIC_IMPORT_RE = /import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function parseFileContentRegex(content: string, relPath: string): FileImport[] {
  const results: FileImport[] = [];
  const lines = content.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  function lineOfIndex(idx: number): number {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if ((lineStarts[mid] ?? 0) <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
  for (const m of content.matchAll(STATIC_IMPORT_RE)) {
    const spec = m[1];
    if (!spec || !isBareSpecifier(spec)) continue;
    results.push({ filePath: relPath, packageName: packageNameFromSpecifier(spec), importType: "static", line: lineOfIndex(m.index ?? 0) });
  }
  for (const m of content.matchAll(REQUIRE_RE)) {
    const spec = m[1];
    if (!spec || !isBareSpecifier(spec)) continue;
    results.push({ filePath: relPath, packageName: packageNameFromSpecifier(spec), importType: "require", line: lineOfIndex(m.index ?? 0) });
  }
  for (const m of content.matchAll(DYNAMIC_IMPORT_RE)) {
    const spec = m[1];
    if (!spec || !isBareSpecifier(spec)) continue;
    const idx = m.index ?? 0;
    const already = results.some((r) => r.line === lineOfIndex(idx) && r.packageName === packageNameFromSpecifier(spec));
    if (already) continue;
    results.push({ filePath: relPath, packageName: packageNameFromSpecifier(spec), importType: "dynamic", line: lineOfIndex(idx) });
  }
  return results;
}

// --- ESTree/TS AST path ---
function parseFileContentTs(content: string, relPath: string): FileImport[] | null {
  let sf: ts.SourceFile;
  try {
    sf = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  } catch {
    return null;
  }
  // If too many parse errors, fallback to regex
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
  if (diags && diags.length > 20) return null;

  const results: FileImport[] = [];

  function lineOf(node: ts.Node): number {
    try {
      return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    } catch {
      return 1;
    }
  }

  function visit(node: ts.Node) {
    try {
      // static import: import x from "pkg" / import "pkg" / import type ...
      // also export ... from "pkg" treated as static dependency
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const mod = (node as ts.ImportDeclaration | ts.ExportDeclaration).moduleSpecifier;
        if (mod && ts.isStringLiteral(mod)) {
          const spec = mod.text;
          if (isBareSpecifier(spec)) {
            results.push({ filePath: relPath, packageName: packageNameFromSpecifier(spec), importType: "static", line: lineOf(mod) });
          }
        }
      } else if (ts.isImportEqualsDeclaration(node)) {
        // import foo = require("pkg")
        if (node.moduleReference && ts.isExternalModuleReference(node.moduleReference)) {
          const expr = node.moduleReference.expression;
          if (expr && ts.isStringLiteral(expr) && isBareSpecifier(expr.text)) {
            results.push({ filePath: relPath, packageName: packageNameFromSpecifier(expr.text), importType: "require", line: lineOf(expr) });
          }
        }
      } else if (ts.isCallExpression(node)) {
        const expr = node.expression;
        const arg0 = node.arguments[0];
        // require("pkg")
        if (ts.isIdentifier(expr) && expr.text === "require" && arg0 && ts.isStringLiteral(arg0) && isBareSpecifier(arg0.text)) {
          results.push({ filePath: relPath, packageName: packageNameFromSpecifier(arg0.text), importType: "require", line: lineOf(arg0) });
        }
        // dynamic import("pkg") — Callee is ImportKeyword (ts.SyntaxKind.ImportKeyword = 104)
        if (expr.kind === ts.SyntaxKind.ImportKeyword && arg0 && ts.isStringLiteral(arg0) && isBareSpecifier(arg0.text)) {
          results.push({ filePath: relPath, packageName: packageNameFromSpecifier(arg0.text), importType: "dynamic", line: lineOf(arg0) });
        }
      } else if (ts.isImportTypeNode(node)) {
        // import("pkg").Foo — type query
        const arg = (node as unknown as { argument?: ts.TypeNode }).argument;
        if (arg && ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal) && isBareSpecifier(arg.literal.text)) {
          results.push({ filePath: relPath, packageName: packageNameFromSpecifier(arg.literal.text), importType: "static", line: lineOf(arg.literal) });
        }
      }
    } catch {}
    ts.forEachChild(node, visit);
  }

  try {
    visit(sf);
  } catch {
    return null;
  }
  return results;
}

function parseFileContent(content: string, relPath: string): FileImport[] {
  const estree = parseFileContentTs(content, relPath);
  if (estree !== null) return estree;
  return parseFileContentRegex(content, relPath);
}

/**
 * ESTree-backed parse. Scans repo excluding node_modules/.git etc.
 * - Primary: typescript ESTree (ts.createSourceFile, ScriptKind.TSX) — handles
 *   import x from "pkg", import "pkg", export * from "pkg", require("pkg"), import("pkg"), import("pkg").Foo
 * - Fallback: regex for files with >20 parseDiagnostics or syntax not handled.
 */
export async function parseImports(repoDir: string): Promise<FileImport[]> {
  const files: string[] = [];
  await walkFiles(repoDir, files);

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

export const _internal = {
  parseFileContent,
  parseFileContentTs,
  parseFileContentRegex,
  packageNameFromSpecifier,
  isBareSpecifier,
};
