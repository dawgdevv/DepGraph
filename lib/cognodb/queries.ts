import { getSession } from "../cognodb";
import type { Analysis } from "../graph";

/**
 * Fetch graph built by worker/graph/write-graph.ts for an analysisId.
 * Returns Analysis-shaped payload for Explorer.
 * If CognoDB not configured or no data, returns null.
 */
export async function getGraph(analysisId: string): Promise<Analysis | null> {
  const hasEnv = !!process.env.COGNODB_URI || !!process.env.NEO4J_URI;
  if (!hasEnv) return null;

  const session = getSession();
  try {
    // Project
    const projRes = await session.run(
      "MATCH (p:Project {id: $analysisId}) RETURN p",
      { analysisId }
    );
    if (projRes.records.length === 0) return null;
    const proj = projRes.records[0]?.get("p").properties as {
      name: string;
      id: string;
    };
    const projectName: string = proj.name ?? analysisId;

    // Packages
    const pkgRes = await session.run(
      "MATCH (pkg:Package {analysisId: $analysisId}) RETURN pkg",
      { analysisId }
    );
    const packages: Array<{
      id: string;
      name: string;
      version: string;
      isDirect: boolean;
    }> = pkgRes.records.map((r) => {
      const p = r.get("pkg").properties;
      return {
        id: p.id as string,
        name: p.name as string,
        version: p.version as string,
        isDirect: p.isDirect as boolean,
      };
    });

    // Vulnerabilities
    const vulnRes = await session.run(
      "MATCH (v:Vulnerability {analysisId: $analysisId}) RETURN v",
      { analysisId }
    );
    const vulns: Array<{
      id: string;
      packageName: string;
      installedVersion: string;
      severity: string;
      identifier: string | null;
      affectedRange: string | null;
      summary: string | null;
      fixVersion: string | null;
      cves: string[] | null;
      primaryParent: string | null;
      recommendedAction: string | null;
      runnableFixCommand: string | null;
      relationship: string | null;
      dependencyPaths: string | null;
    }> = vulnRes.records.map((r) => {
      const v = r.get("v").properties;
      return {
        id: v.id as string,
        packageName: v.packageName as string,
        installedVersion: v.installedVersion as string,
        severity: v.severity as string,
        identifier: v.identifier as string | null,
        affectedRange: v.affectedRange as string | null,
        summary: (v.summary as string) ?? null,
        fixVersion: (v.fixVersion as string) ?? null,
        cves: (v.cves as string[]) ?? null,
        primaryParent: (v.primaryParent as string) ?? null,
        recommendedAction: (v.recommendedAction as string) ?? null,
        runnableFixCommand: (v.runnableFixCommand as string) ?? null,
        relationship: (v.relationship as string) ?? null,
        dependencyPaths: (v.dependencyPaths as string) ?? null,
      };
    });

    // Files
    const fileRes = await session.run(
      "MATCH (f:File {analysisId: $analysisId}) RETURN f",
      { analysisId }
    );
    const files: Array<{ id: string; path: string }> = fileRes.records.map((r) => {
      const f = r.get("f").properties;
      return { id: f.id as string, path: f.path as string };
    });

    // Edges: DEPENDS_ON (Project->Package and Package->Package) + HAS_VULNERABILITY + IMPORTS/CONTAINS
    const edgeRes = await session.run(
      `
      MATCH (a {analysisId: $analysisId})-[r:DEPENDS_ON|HAS_VULNERABILITY|IMPORTS|CONTAINS]->(b {analysisId: $analysisId})
      RETURN a.id AS source, b.id AS target, type(r) AS kind
      `,
      { analysisId }
    );
    const edges: Analysis["edges"] = edgeRes.records.map((r) => {
      const kind = r.get("kind") as string;
      // HAS_VULNERABILITY is rendered as DEPENDS_ON in Explorer demo (vuln node depth 4)
      const mappedKind = kind === "HAS_VULNERABILITY" ? "DEPENDS_ON" : kind === "CONTAINS" ? "IMPORTS" : kind;
      return {
        id: `${r.get("source") as string}->${r.get("target") as string}:${kind}`,
        source: r.get("source") as string,
        target: r.get("target") as string,
        kind: (mappedKind === "IMPORTS" ? "IMPORTS" : "DEPENDS_ON") as "DEPENDS_ON" | "IMPORTS",
      };
    });

    // Also fetch Project->Package direct edges that were created as DEPENDS_ON but source is Project id = analysisId
    // Already covered via above query (a includes Project)

    // Build nodes for Explorer
    const nodes: Analysis["nodes"] = [];

    // Project node
    nodes.push({
      id: analysisId,
      kind: "project",
      label: projectName,
      depth: 0,
    });

    // Package nodes — depth heuristically: direct =1, transitive by BFS from project
    // For now assign depth 1 if isDirect else 2, refined by graph distance if needed
    const directIds = new Set(
      packages.filter((p) => p.isDirect).map((p) => p.id)
    );
    for (const pkg of packages) {
      // label is package short id without analysis prefix for display: name
      const shortId = pkg.id; // keep full id for uniqueness
      nodes.push({
        id: shortId,
        kind: "package",
        label: pkg.name,
        sub: pkg.version,
        depth: pkg.isDirect ? 1 : 2,
        isDirect: pkg.isDirect,
      });
    }

    // Vulnerability nodes
    for (const v of vulns) {
      nodes.push({
        id: v.id,
        kind: "vuln",
        label: v.identifier ?? v.packageName,
        sub: v.severity.toUpperCase(),
        depth: 4,
        severity: (v.severity === "high" || v.severity === "critical" ? "high" : "moderate") as "high" | "moderate",
      });
    }

    // File nodes (optional, shown when files toggle)
    for (const f of files) {
      nodes.push({
        id: f.id,
        kind: "file",
        label: f.path,
        depth: 0,
      });
    }

    // Adjust transitive package depth via BFS from project (if we have edges)
    // Simple BFS to set depth = shortest path length from project
    try {
      const dist = new Map<string, number>();
      dist.set(analysisId, 0);
      const adj = new Map<string, string[]>();
      for (const e of edges) {
        if (e.kind !== "DEPENDS_ON") continue;
        if (!adj.has(e.source)) adj.set(e.source, []);
        adj.get(e.source)!.push(e.target);
      }
      const q: string[] = [analysisId];
      while (q.length) {
        const cur = q.shift()!;
        const d = dist.get(cur) ?? 0;
        for (const nb of adj.get(cur) ?? []) {
          if (!dist.has(nb)) {
            dist.set(nb, d + 1);
            q.push(nb);
          }
        }
      }
      for (const n of nodes) {
        if (n.kind === "package" && dist.has(n.id)) {
          n.depth = dist.get(n.id)!;
        }
        if (n.kind === "vuln" && dist.has(n.id)) {
          n.depth = dist.get(n.id)!;
        }
      }
    } catch {}

    // Vulnerabilities for Explorer panel
    const vulnerabilities: Analysis["vulnerabilities"] = vulns.map((v) => ({
      key: v.id,
      packageName: v.packageName,
      version: v.installedVersion,
      severity: (v.severity === "high" || v.severity === "critical" ? "high" : "moderate") as "high" | "moderate",
      identifier: v.identifier ?? v.packageName,
      affectedRange: v.affectedRange ?? "",
      summary: v.summary ?? undefined,
      fixVersion: v.fixVersion ?? undefined,
      cves: v.cves ?? undefined,
      primaryParent: v.primaryParent ?? undefined,
      recommendedAction: v.recommendedAction ?? undefined,
      runnableFixCommand: v.runnableFixCommand ?? undefined,
      relationship: v.relationship ?? undefined,
      dependencyPaths: v.dependencyPaths ? (JSON.parse(v.dependencyPaths) as string[][]) : undefined,
      blastRadius: {
        dependentPackages: 0,
        dependencyPaths: 0,
        directPaths: 0,
        transitivePaths: 0,
        pathNodeIds: [],
      },
    }));

    // File imports for panel
    const fileImports: Analysis["fileImports"] = [];
    // Query IMPORTS edges with source file id -> target package
    try {
      const impRes = await session.run(
        `
        MATCH (f:File {analysisId: $analysisId})-[r:IMPORTS]->(pkg:Package {analysisId: $analysisId})
        RETURN f.path AS file, pkg.id AS pkgId, pkg.name AS pkgName, r.line AS line
        `,
        { analysisId }
      );
      for (const r of impRes.records) {
        fileImports.push({
          file: r.get("file") as string,
          pkgId: r.get("pkgId") as string,
          pkgName: r.get("pkgName") as string,
          line: r.get("line") as number,
        });
      }
    } catch {}

    // Blast radius — per vuln: dependentPackages, paths, direct/transitive, pathNodeIds for highlight
    for (const vuln of vulnerabilities) {
      try {
        const brRes = await session.run(
          `
          MATCH (proj:Project {id: $analysisId})
          MATCH (pkg:Package)-[:HAS_VULNERABILITY]->(v:Vulnerability {id: $vulnId})
          MATCH path = (proj)-[:DEPENDS_ON*]->(pkg)
          RETURN [n IN nodes(path) | n.id] AS pathIds, length(path) AS len
          LIMIT 25
          `,
          { vulnId: vuln.key, analysisId }
        );
        const pathNodeIds: string[][] = [];
        let directPaths = 0;
        const depSet = new Set<string>();
        for (const rec of brRes.records) {
          const pids = rec.get("pathIds") as string[];
          // append vuln node id at end for highlight (pkg -> vuln edge)
          const fullPath = [...pids, vuln.key];
          pathNodeIds.push(fullPath);
          const len = rec.get("len") as unknown as number | { toNumber: () => number; low: number };
          const l = typeof len === "number" ? len : typeof (len as { toNumber?: () => number }).toNumber === "function" ? (len as { toNumber: () => number }).toNumber() : (len as { low: number }).low ?? 0;
          if (l === 1) directPaths++;
          for (const nid of pids) {
            if (nid !== analysisId) depSet.add(nid);
          }
          depSet.add(vuln.key); // include vuln? demo counts pkg itself, but we count packages only
        }
        // dependentPackages: distinct package ids (exclude project, exclude vuln if counted)
        // filter to package ids only (those that are Package nodes)
        const depPkgs = [...depSet].filter((id) => id !== vuln.key).length;
        // If no paths found but package exists, at least pkg itself is dependent 1?
        const dependentPackages = depPkgs > 0 ? depPkgs : (await session.run("MATCH (pkg:Package)-[:HAS_VULNERABILITY]->(v {id: $vulnId}) RETURN pkg", { vulnId: vuln.key }).then((r) => (r.records.length > 0 ? 1 : 0)));
        const total = pathNodeIds.length;
        vuln.blastRadius.dependentPackages = typeof dependentPackages === "number" ? dependentPackages : (dependentPackages as unknown as number);
        vuln.blastRadius.dependencyPaths = total;
        vuln.blastRadius.directPaths = directPaths;
        vuln.blastRadius.transitivePaths = total - directPaths;
        vuln.blastRadius.pathNodeIds = pathNodeIds;
      } catch (e) {
        console.warn(`[getGraph] blast radius failed for ${vuln.key}:`, (e as Error).message);
      }
    }

    // Stats derived
    const direct = packages.filter((p) => p.isDirect).length;
    const transitive = packages.length - direct;

    // Affected paths count (total paths to any vuln)
    let affectedPaths = 0;
    try {
      const apRes = await session.run(
        `
        MATCH (proj:Project {id: $analysisId})
        MATCH (v:Vulnerability {analysisId: $analysisId})
        MATCH (pkg:Package)-[:HAS_VULNERABILITY]->(v)
        MATCH path = (proj)-[:DEPENDS_ON*]->(pkg)
        RETURN count(path) AS cnt
        `,
        { analysisId }
      );
      const row = apRes.records[0];
      const val = row?.get("cnt") as unknown as { toNumber?: () => number; low?: number } | number;
      if (typeof val === "number") affectedPaths = val;
      else if (val && typeof (val as { toNumber: () => number }).toNumber === "function")
        affectedPaths = (val as { toNumber: () => number }).toNumber();
      else if (val && typeof (val as { low: number }).low === "number")
        affectedPaths = (val as { low: number }).low;
    } catch {}

    const analysis: Analysis = {
      id: analysisId,
      repositoryUrl: `https://github.com/${projRes.records[0]?.get("p").properties.repoPath ?? ""}` || "",
      name: projectName,
      stats: {
        packages: packages.length,
        direct,
        transitive,
        vulnerable: vulns.length,
        affectedPaths,
      },
      nodes,
      edges,
      vulnerabilities,
      fileImports,
    };

    // repo URL fallback from store if needed — caller may override
    return analysis;
  } finally {
    await session.close().catch(() => {});
  }
}
