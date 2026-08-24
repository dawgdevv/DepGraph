import type { FileImport, PackageRecord, VulnerabilityFinding } from "../types";
import { getSession } from "../../lib/cognodb";

export type WriteGraphInput = {
  analysisId: string;
  projectName: string;
  repositoryUrl?: string;
  repoPath?: string;
  packages: PackageRecord[];
  vulnerabilities: VulnerabilityFinding[];
  fileImports: FileImport[];
};

export type WriteGraphResult = {
  affectedPaths: number;
};

let constraintsEnsured = false;
async function ensureConstraints(): Promise<void> {
  if (constraintsEnsured) return;
  const session = getSession();
  const statements = [
    "CREATE CONSTRAINT project_id IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT package_id IF NOT EXISTS FOR (p:Package) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT vulnerability_id IF NOT EXISTS FOR (v:Vulnerability) REQUIRE v.id IS UNIQUE",
    "CREATE CONSTRAINT file_id IF NOT EXISTS FOR (f:File) REQUIRE f.id IS UNIQUE",
  ];
  for (const cypher of statements) {
    try {
      await session.run(cypher);
    } catch {}
  }
  await session.close().catch(() => {});
  constraintsEnsured = true;
}

export async function writeGraph(input: WriteGraphInput): Promise<WriteGraphResult> {
  const { analysisId, projectName, repositoryUrl, repoPath, packages, vulnerabilities, fileImports } = input;

  const hasEnv = !!process.env.COGNODB_URI || !!process.env.NEO4J_URI;
  if (!hasEnv) {
    console.warn("[writeGraph] COGNODB_URI not set — skipping graph write (local dev)");
    return { affectedPaths: 0 };
  }

  await ensureConstraints();
  const limitedFileImports = fileImports.length > 150 ? fileImports.slice(0, 150) : fileImports;

  const session = getSession();
  try {
    // 0. Cleanup — own transaction
    await session.run("MATCH (n {analysisId: $analysisId}) DETACH DELETE n", { analysisId });

    // 1. Project
    await session.run(
      `
        MERGE (p:Project {id: $projectId})
        SET p.name = $projectName,
            p.analysisId = $analysisId,
            p.repositoryUrl = $repositoryUrl,
            p.repoPath = $repoPath,
            p.createdAt = datetime()
        `,
      { projectId: analysisId, projectName, analysisId, repositoryUrl: repositoryUrl ?? null, repoPath: repoPath ?? null }
    );

    if (packages.length > 0) {
      const pkgRows = packages.map((pkg) => ({
        pkgId: `${analysisId}:${pkg.id}`,
        name: pkg.name,
        version: pkg.version,
        isDirect: pkg.isDirect,
        lockKey: pkg.lockKey,
      }));
      await session.run(
        `
          UNWIND $rows AS row
          MERGE (pkg:Package {id: row.pkgId})
          SET pkg.name = row.name,
              pkg.version = row.version,
              pkg.analysisId = $analysisId,
              pkg.isDirect = row.isDirect,
              pkg.lockKey = row.lockKey
          WITH row, pkg
          MATCH (proj:Project {id: $projectId})
          WHERE row.isDirect = true
          MERGE (proj)-[:DEPENDS_ON]->(pkg)
          `,
        { rows: pkgRows, analysisId, projectId: analysisId }
      );

      const depRows: Array<{ sourceId: string; depName: string }> = [];
      for (const pkg of packages) {
        const sourceId = `${analysisId}:${pkg.id}`;
        for (const depName of pkg.dependencies) depRows.push({ sourceId, depName });
      }
      if (depRows.length > 0) {
        // chunk to avoid large payload deadline
        const chunkSize = 200;
        for (let i = 0; i < depRows.length; i += chunkSize) {
          const chunk = depRows.slice(i, i + chunkSize);
          await session.run(
            `
            UNWIND $rows AS row
            MATCH (src:Package {id: row.sourceId})
            MATCH (dst:Package {analysisId: $analysisId, name: row.depName})
            MERGE (src)-[:DEPENDS_ON]->(dst)
            `,
            { rows: chunk, analysisId }
          );
        }
      }
    }

    if (vulnerabilities.length > 0) {
      const vulnRows = vulnerabilities.map((v, i) => ({
        vulnId: `${analysisId}:vuln:${v.packageName}@${v.installedVersion}:${v.identifier ?? v.severity}:${i}`,
        packageName: v.packageName,
        installedVersion: v.installedVersion,
        severity: v.severity,
        identifier: v.identifier ?? null,
        affectedRange: v.affectedRange ?? null,
        summary: v.summary ?? null,
        fixVersion: v.fixVersion ?? null,
        cves: v.cves ?? null,
        primaryParent: v.primaryParent ?? null,
        recommendedAction: v.recommendedAction ?? null,
        runnableFixCommand: v.runnableFixCommand ?? null,
        relationship: v.relationship ?? null,
        dependencyPaths: v.dependencyPaths ? JSON.stringify(v.dependencyPaths) : null,
      }));
      await session.run(
        `
          UNWIND $rows AS row
          MERGE (v:Vulnerability {id: row.vulnId})
          SET v.packageName = row.packageName,
              v.installedVersion = row.installedVersion,
              v.severity = row.severity,
              v.identifier = row.identifier,
              v.affectedRange = row.affectedRange,
              v.summary = row.summary,
              v.fixVersion = row.fixVersion,
              v.cves = row.cves,
              v.primaryParent = row.primaryParent,
              v.recommendedAction = row.recommendedAction,
              v.runnableFixCommand = row.runnableFixCommand,
              v.relationship = row.relationship,
              v.dependencyPaths = row.dependencyPaths,
              v.analysisId = $analysisId
          WITH row, v
          MATCH (pkg:Package {analysisId: $analysisId, name: row.packageName, version: row.installedVersion})
          MERGE (pkg)-[:HAS_VULNERABILITY]->(v)
          `,
        { rows: vulnRows, analysisId }
      );
      await session.run(
        `
          UNWIND $rows AS row
          MATCH (v:Vulnerability {id: row.vulnId})
          WHERE NOT EXISTS { MATCH (pkg:Package)-[:HAS_VULNERABILITY]->(v) }
          MATCH (pkg:Package {analysisId: $analysisId, name: row.packageName})
          MERGE (pkg)-[:HAS_VULNERABILITY]->(v)
          `,
        { rows: vulnRows, analysisId }
      );
    }

    if (limitedFileImports.length > 0) {
      const fileMap = new Map<string, string>();
      for (const fi of limitedFileImports) fileMap.set(fi.filePath, fi.filePath);
      const fileRows = [...fileMap.entries()].map(([filePath]) => ({
        fileId: `${analysisId}:file:${filePath}`,
        filePath,
      }));
      await session.run(
        `
          UNWIND $rows AS row
          MERGE (f:File {id: row.fileId})
          SET f.path = row.filePath,
              f.analysisId = $analysisId
          WITH row, f
          MATCH (proj:Project {id: $projectId})
          MERGE (proj)-[:CONTAINS]->(f)
          `,
        { rows: fileRows, analysisId, projectId: analysisId }
      );
      const importRows = limitedFileImports.map((fi) => ({
        fileId: `${analysisId}:file:${fi.filePath}`,
        packageName: fi.packageName,
        importType: fi.importType,
        line: fi.line,
      }));
      // chunk imports too
      const chunkSize = 200;
      for (let i = 0; i < importRows.length; i += chunkSize) {
        const chunk = importRows.slice(i, i + chunkSize);
        await session.run(
          `
          UNWIND $rows AS row
          MATCH (f:File {id: row.fileId})
          MATCH (pkg:Package {analysisId: $analysisId, name: row.packageName})
          MERGE (f)-[r:IMPORTS {line: row.line, importType: row.importType}]->(pkg)
          `,
          { rows: chunk, analysisId }
        );
      }
    }

    let affectedPaths = 0;
    try {
      const res = await session.run(
        `
        MATCH (proj:Project {id: $analysisId})
        MATCH (v:Vulnerability {analysisId: $analysisId})
        MATCH (pkg:Package)-[:HAS_VULNERABILITY]->(v)
        MATCH path = (proj)-[:DEPENDS_ON*]->(pkg)
        RETURN count(path) AS cnt
        `,
        { analysisId }
      );
      const row = res.records[0];
      affectedPaths = row ? (row.get("cnt") as unknown as { toNumber?: () => number; low?: number }) as unknown as number : 0;
      if (affectedPaths && typeof (affectedPaths as unknown as { toNumber: () => number }).toNumber === "function") {
        affectedPaths = (affectedPaths as unknown as { toNumber: () => number }).toNumber();
      } else if (affectedPaths && typeof (affectedPaths as unknown as { low: number }).low === "number") {
        affectedPaths = (affectedPaths as unknown as { low: number }).low;
      }
    } catch {
      affectedPaths = 0;
    }

    return { affectedPaths };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[writeGraph] CognoDB error:", msg);
    if (msg.includes("deadline exceeded") || msg.includes("timeout") || msg.includes("Connection") || msg.includes("ServiceUnavailable") || msg.includes("TransientError")) {
      console.warn("[writeGraph] transient CognoDB error — analysis will complete without graph, /api/graph will 404");
      return { affectedPaths: 0 };
    }
    throw new Error("The dependency graph is temporarily unavailable. Please try again.");
  } finally {
    await session.close().catch(() => {});
  }
}
