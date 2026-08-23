import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getAnalysis,
  updateAnalysis,
  type AnalysisStats,
} from "./store";
import { cloneRepository } from "./repository/clone";
import { validateRepository, ValidationError } from "./validate";
import { parseLockfile } from "./parse-lockfile";
import { runCveLite, ScanError } from "./run-cve-lite";
import { parseImports } from "./parse-imports";
import { writeGraph } from "./graph/write-graph";

function projectNameFromRepoPath(repoPath: string): string {
  const parts = repoPath.split("/");
  return parts[parts.length - 1] ?? repoPath;
}

function tmpDirFor(analysisId: string): string {
  return path.join(os.tmpdir(), `depgraph-${analysisId}`);
}

function sanitizeError(err: unknown): string {
  if (err instanceof ValidationError || err instanceof ScanError) {
    return err.message;
  }
  if (err instanceof Error) {
    // Avoid leaking stack/paths/secrets to UI
    const msg = err.message.trim();
    if (
      msg.includes("package.json") ||
      msg.includes("package-lock.json") ||
      msg.includes("We couldn't read") ||
      msg.includes("Vulnerability scan failed") ||
      msg.includes("dependency graph is temporarily unavailable")
    ) {
      return msg;
    }
    // fallback sanitized
    return "We couldn't analyze this repository.";
  }
  return "We couldn't analyze this repository.";
}

/**
 * runAnalysis — fire-and-forget per route.ts.
 * Stages: cloning → parsing → scanning → building_graph → complete
 * Cleanup: rm -rf tmpDir always.
 */
export async function runAnalysis(analysisId: string): Promise<void> {
  const record = getAnalysis(analysisId);
  if (!record) return;
  if (record.status !== "queued") return;

  const tmpDir = tmpDirFor(analysisId);
  const repoPath = record.repoPath; // e.g. "owner/repo"
  const repositoryUrl = record.repositoryUrl; // https://github.com/owner/repo

  try {
    // 1. Clone
    updateAnalysis(analysisId, { status: "cloning" });
    await mkdir(tmpDir, { recursive: true });
    // Ensure clean if leftover from prior run
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });
    await cloneRepository(repositoryUrl, tmpDir);

    // 2. Validate
    updateAnalysis(analysisId, { status: "parsing" });
    await validateRepository(tmpDir);

    // 3. Parse lockfile
    const lockResult = await parseLockfile(tmpDir);

    // 5. Parse imports (regex pass) — run concurrently with scan for speed
    // but keep status semantics: scan stage thereafter.
    const fileImportsPromise = parseImports(tmpDir);

    // 4. Scan
    updateAnalysis(analysisId, { status: "scanning" });
    let vulnerabilities: Awaited<ReturnType<typeof runCveLite>>;
    try {
      vulnerabilities = await runCveLite(tmpDir);
    } catch (e) {
      // CVE-Lite failure copy per PRD §11
      if (e instanceof ScanError) throw e;
      throw new ScanError(
        "Vulnerability scan failed. Results could not be associated with the dependency graph."
      );
    }

    const fileImports = await fileImportsPromise;

    // 6. Write graph (CognoDB)
    updateAnalysis(analysisId, { status: "building_graph" });
    let affectedPaths = 0;
    try {
      const res = await writeGraph({
        analysisId,
        projectName: projectNameFromRepoPath(repoPath),
        repositoryUrl,
        repoPath,
        packages: lockResult.packages,
        vulnerabilities,
        fileImports,
      });
      affectedPaths = res.affectedPaths;
    } catch (e) {
      // CognoDB unavailable copy per PRD §11
      const msg =
        e instanceof Error && e.message
          ? e.message
          : "The dependency graph is temporarily unavailable. Please try again.";
      throw new Error(
        msg.includes("temporarily unavailable")
          ? msg
          : "The dependency graph is temporarily unavailable. Please try again."
      );
    }

    // 7. Stats + complete
    const stats: AnalysisStats = {
      packages: lockResult.totalCount,
      direct: lockResult.directCount,
      transitive: lockResult.transitiveCount,
      vulnerable: vulnerabilities.length,
      affectedPaths,
    };

    updateAnalysis(analysisId, {
      status: "complete",
      completedAt: Date.now(),
      stats,
    });
  } catch (err) {
    updateAnalysis(analysisId, {
      status: "failed",
      error: sanitizeError(err),
    });
  } finally {
    // 7. Cleanup
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
  }
}

// Re-exports for route / tests
export { cloneRepository } from "./repository/clone";
export { validateRepository } from "./validate";
export { parseLockfile } from "./parse-lockfile";
export { runCveLite } from "./run-cve-lite";
export { parseImports } from "./parse-imports";
export { writeGraph } from "./graph/write-graph";
