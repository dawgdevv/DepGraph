"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Analysis, GraphEdge, GraphNode } from "@/lib/graph";
import GraphCanvas from "./graph-canvas";
import { DetailsPanel, LeftPanel, useHighlightSets } from "./panels";

const FILE_GROUP_THRESHOLD = 40;
const FILE_GROUP_MAX_GROUPS = 12;
const PKG_GROUP_THRESHOLD = 999999; // disabled — file based only per request

function dirOf(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "root";
  if (parts.length === 2) return parts.slice(0, 1).join("/");
  return parts.slice(0, 2).join("/");
}

export default function Explorer({ analysis }: { analysis: Analysis }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showFiles, setShowFiles] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{ nodeId: string; seq: number } | null>(null);
  const [mode, setMode] = useState<{ type: "blast"; vulnKey: string } | { type: "neighbors"; id: string; dir: "in" | "out" } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [groupByModule, setGroupByModule] = useState(true);

  // Auto-expand modules that are on blast path so highlight is visible
  useEffect(() => {
    if (mode?.type === "blast") {
      const v = analysis.vulnerabilities.find((x) => x.key === mode.vulnKey);
      if (!v) return;
      const toExpand = new Set<string>();
      for (const p of v.blastRadius.pathNodeIds.flat()) {
        // p may be package id; find its module
        const pkgNode = analysis.nodes.find((n) => n.id === p);
        if (pkgNode?.kind === "package") {
          // find module for this pkg via current grouping logic (first hop)
          // we will compute module map lazily — just expand all modules that contain this pkg
          // For now expand all file-groups and modules when blast active
          for (const n of analysis.nodes) if (n.id.startsWith("module:")) toExpand.add(n.id);
          for (const n of analysis.nodes) if (n.id.startsWith("file-group:")) toExpand.add(n.id);
        }
      }
      if (toExpand.size > 0) setExpanded((prev) => new Set([...prev, ...toExpand]));
    }
  }, [mode, analysis]);

  const relevantFileImports = useMemo(() => {
    if (!showFiles) return [] as typeof analysis.fileImports;
    let rel = analysis.fileImports;
    const q = query.trim().toLowerCase();
    const selNode = selectedId ? analysis.nodes.find((n) => n.id === selectedId) ?? null : null;
    if (selNode?.kind === "package") {
      const filtered = rel.filter((f) => f.pkgName === selNode.label || f.pkgId === selNode.id);
      if (filtered.length > 0) rel = filtered;
    } else if (selNode?.kind === "vuln") {
      const v = analysis.vulnerabilities.find((x) => x.key === selectedId);
      if (v) {
        const filtered = rel.filter((f) => f.pkgName === v.packageName);
        if (filtered.length > 0) rel = filtered;
      }
    }
    if (q) rel = rel.filter((f) => f.file.toLowerCase().includes(q) || f.pkgName.toLowerCase().includes(q));
    return rel;
  }, [analysis.fileImports, analysis.nodes, analysis.vulnerabilities, showFiles, selectedId, query]);

  // Package module grouping
  const pkgModule = useMemo(() => {
    if (!groupByModule) return null as null | { map: Map<string, string>; groups: Map<string, GraphNode[]> };
    const pkgs = analysis.nodes.filter((n) => n.kind === "package");
    if (pkgs.length <= PKG_GROUP_THRESHOLD) return null;
    // Build adjacency: source -> targets
    const adj = new Map<string, string[]>();
    for (const e of analysis.edges) if (e.kind === "DEPENDS_ON") {
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source)!.push(e.target);
    }
    // BFS from project to assign module = first direct child
    const directIds = new Set(pkgs.filter((p) => p.isDirect).map((p) => p.id));
    const moduleMap = new Map<string, string>(); // pkgId -> moduleId (direct pkg id)
    const q: Array<{ id: string; mod: string | null }> = [];
    // seed direct
    for (const d of directIds) {
      moduleMap.set(d, d);
      q.push({ id: d, mod: d });
    }
    // also project as source
    const projId = analysis.nodes.find((n) => n.kind === "project")?.id;
    if (projId) {
      for (const child of adj.get(projId) ?? []) if (!moduleMap.has(child)) { moduleMap.set(child, child); q.push({ id: child, mod: child }); }
    }
    const visited = new Set<string>([...moduleMap.keys()]);
    if (projId) visited.add(projId);
    while (q.length) {
      const cur = q.shift()!;
      for (const nb of adj.get(cur.id) ?? []) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        const mod = cur.mod ?? (directIds.has(cur.id) ? cur.id : null);
        if (mod) moduleMap.set(nb, mod);
        q.push({ id: nb, mod: mod ?? cur.mod });
      }
    }
    // Any unvisited transitive not reachable? assign to itself as module
    for (const p of pkgs) if (!moduleMap.has(p.id)) moduleMap.set(p.id, p.id);

    const groups = new Map<string, GraphNode[]>();
    for (const p of pkgs) {
      const mod = moduleMap.get(p.id) ?? p.id;
      const arr = groups.get(mod) ?? [];
      arr.push(p);
      groups.set(mod, arr);
    }
    return { map: moduleMap, groups };
  }, [analysis, groupByModule]);

  const nodes = useMemo(() => {
    let base: GraphNode[] = [...analysis.nodes];

    // Package modules: collapse unless expanded
    if (pkgModule) {
      const collapsedModules: GraphNode[] = [];
      const keepPkgs = new Set<string>();
      for (const [modId, pkgs] of pkgModule.groups) {
        const isExpanded = expanded.has(`module:${modId}`);
        if (isExpanded) {
          for (const p of pkgs) keepPkgs.add(p.id);
        } else {
          const directNode = analysis.nodes.find((n) => n.id === modId);
          const label = directNode?.label ?? modId;
          collapsedModules.push({
            id: `module:${modId}`,
            kind: "package",
            label: `${label}`,
            sub: `${pkgs.length} pkgs`,
            depth: 1,
            isDirect: true,
          });
        }
      }
      // Filter base packages: keep only those in expanded modules or direct modules themselves not collapsed
      const filtered = base.filter((n) => {
        if (n.kind !== "package") return true;
        if (keepPkgs.has(n.id)) return true;
        // if its module is collapsed, hide it (replaced by module node)
        const mod = pkgModule.map.get(n.id);
        if (!mod) return true;
        return expanded.has(`module:${mod}`);
      });
      base = [...filtered.filter((n) => n.kind !== "package" || keepPkgs.has(n.id) || !pkgModule.map.has(n.id)), ...collapsedModules, ...base.filter((n) => n.kind !== "package" && n.kind !== "project")];
      // Actually need project + vuln + file? Simplify: rebuild
      const project = analysis.nodes.find((n) => n.kind === "project")!;
      const vulns = analysis.nodes.filter((n) => n.kind === "vuln");
      const pkgsToShow = base.filter((n) => n.kind === "package");
      base = [project, ...pkgsToShow, ...vulns];
    }

    if (!showFiles) return base;

    const rel = relevantFileImports;
    if (rel.length === 0) return base;

    if (rel.length > FILE_GROUP_THRESHOLD) {
      const groups = new Map<string, { files: typeof rel; pkgSet: Set<string> }>();
      for (const fi of rel) {
        const d = dirOf(fi.file);
        const g = groups.get(d) ?? { files: [], pkgSet: new Set() };
        g.files.push(fi);
        g.pkgSet.add(fi.pkgName);
        groups.set(d, g);
      }
      const sorted = [...groups.entries()].sort((a, b) => b[1].files.length - a[1].files.length);
      const top = sorted.slice(0, FILE_GROUP_MAX_GROUPS);
      const rest = sorted.slice(FILE_GROUP_MAX_GROUPS);
      if (rest.length > 0) {
        const otherFiles: typeof rel = [];
        const otherPkgs = new Set<string>();
        for (const [, v] of rest) { otherFiles.push(...v.files); for (const p of v.pkgSet) otherPkgs.add(p); }
        top.push([`other (${rest.length} dirs)`, { files: otherFiles, pkgSet: otherPkgs }]);
      }
      const expandedGroups = new Set([...expanded].filter((id) => id.startsWith("file-group:")));
      const groupNodes: GraphNode[] = [];
      const expandedFileNodes: GraphNode[] = [];
      for (const [dir, g] of top) {
        const gid = `file-group:${dir}`;
        if (expanded.has(gid)) {
          // expand this dir into individual files
          for (const fi of g.files) {
            const pkg = analysis.nodes.find((n) => n.label === fi.pkgName || n.id === fi.pkgId);
            expandedFileNodes.push({ id: `file:${fi.file}:${fi.line}:${fi.pkgName}`, kind: "file", label: fi.file, sub: fi.pkgName, depth: Math.max(0, (pkg?.depth ?? 1) - 1) });
          }
        } else {
          let minDepth = Infinity;
          for (const pkgName of g.pkgSet) {
            const pkgNode = analysis.nodes.find((n) => n.label === pkgName);
            if (pkgNode && pkgNode.depth < minDepth) minDepth = pkgNode.depth;
          }
          if (!isFinite(minDepth)) minDepth = 1;
          groupNodes.push({ id: gid, kind: "file", label: dir, sub: `${g.files.length} files → ${[...g.pkgSet].slice(0, 2).join(", ")}${g.pkgSet.size > 2 ? ` +${g.pkgSet.size - 2}` : ""}`, depth: Math.max(0, minDepth - 1) });
        }
      }
      // dedup
      const seen = new Set<string>();
      const dedup: GraphNode[] = [];
      for (const n of [...groupNodes, ...expandedFileNodes]) if (!seen.has(n.id)) { seen.add(n.id); dedup.push(n); }
      return [...base, ...dedup];
    }

    const fileNodes = rel.map((f) => {
      const pkg = analysis.nodes.find((n) => n.id === f.pkgId || n.label === f.pkgName);
      return { id: `file:${f.file}:${f.line}:${f.pkgName}`, kind: "file" as const, label: f.file, sub: f.pkgName, depth: Math.max(0, (pkg?.depth ?? 1) - 1) };
    });
    const seen = new Set<string>();
    const dedup: typeof fileNodes = [];
    for (const fn of fileNodes) if (!seen.has(fn.id)) { seen.add(fn.id); dedup.push(fn); }
    return [...base, ...dedup];
  }, [analysis, showFiles, relevantFileImports, pkgModule, expanded]);

  const edges = useMemo(() => {
    let baseEdges = [...analysis.edges];
    // Package module edges: rewrite when collapsed
    if (pkgModule) {
      const toModule = new Map<string, string>(); // pkgId -> moduleId
      for (const [modId, pkgs] of pkgModule.groups) for (const p of pkgs) toModule.set(p.id, `module:${modId}`);
      const isCollapsed = (pkgId: string) => {
        const mod = pkgModule.map.get(pkgId);
        return mod ? !expanded.has(`module:${mod}`) : false;
      };
      const newEdges: GraphEdge[] = [];
      const seen = new Set<string>();
      const projId = analysis.nodes.find((n) => n.kind === "project")?.id;
      for (const e of baseEdges) {
        if (e.kind !== "DEPENDS_ON") { newEdges.push(e); continue; }
        const srcIsPkg = analysis.nodes.some((n) => n.id === e.source && n.kind === "package");
        const dstIsPkg = analysis.nodes.some((n) => n.id === e.target && n.kind === "package");
        // Also handle vuln edges: source is pkg, target is vuln
        const srcMod = toModule.get(e.source);
        const dstMod = toModule.get(e.target);
        const srcCollapsed = srcMod ? isCollapsed(e.source) : false;
        const dstCollapsed = dstMod ? isCollapsed(e.target) : false;
        let ns = e.source, nt = e.target;
        if (srcCollapsed) ns = srcMod!;
        if (dstCollapsed) nt = dstMod!;
        if (ns === nt) continue; // internal edge hidden
        // Project -> pkg edge: if pkg collapsed, edge becomes Project -> module
        if (e.source === projId && dstCollapsed) nt = dstMod!;
        const eid = `${ns}->${nt}:${e.kind}`;
        if (seen.has(eid)) continue;
        seen.add(eid);
        newEdges.push({ id: eid, source: ns, target: nt, kind: e.kind });
      }
      baseEdges = newEdges;
    }

    if (!showFiles) return baseEdges;
    const rel = relevantFileImports;
    if (rel.length === 0) return baseEdges;

    const pkgIdOf = (fi: typeof rel[number]) => analysis.nodes.find((n) => n.label === fi.pkgName || n.id === fi.pkgId)?.id ?? fi.pkgId;

    if (rel.length > FILE_GROUP_THRESHOLD) {
      const groups = new Map<string, Set<string>>();
      for (const fi of rel) {
        const d = dirOf(fi.file);
        const set = groups.get(d) ?? new Set<string>();
        const pkgId = pkgIdOf(fi);
        // map pkgId to module if collapsed
        let target = pkgId;
        if (pkgModule) {
          const mod = pkgModule.map.get(pkgId);
          if (mod && !expanded.has(`module:${mod}`)) target = `module:${mod}`;
        }
        set.add(target);
        groups.set(d, set);
      }
      const dirCounts = new Map<string, number>();
      for (const fi of rel) dirCounts.set(dirOf(fi.file), (dirCounts.get(dirOf(fi.file)) ?? 0) + 1);
      const sortedByCount = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]);
      const topDirs = new Set(sortedByCount.slice(0, FILE_GROUP_MAX_GROUPS).map(([d]) => d));
      const hasOther = sortedByCount.length > FILE_GROUP_MAX_GROUPS;
      const otherPkgs = new Set<string>();
      for (const [d, pkgs] of groups) if (!topDirs.has(d)) for (const p of pkgs) otherPkgs.add(p);
      const importEdges: GraphEdge[] = [];
      for (const [dir, pkgs] of groups) {
        if (!topDirs.has(dir)) continue;
        const gid = `file-group:${dir}`;
        const isExp = expanded.has(gid);
        if (isExp) continue; // expanded dirs handled as individual files below
        for (const pkgId of pkgs) importEdges.push({ id: `imp:${gid}->${pkgId}`, source: gid, target: pkgId, kind: "IMPORTS" });
      }
      if (hasOther && !expanded.has(`file-group:other (${sortedByCount.length - FILE_GROUP_MAX_GROUPS} dirs)`)) {
        const gid = `file-group:other (${sortedByCount.length - FILE_GROUP_MAX_GROUPS} dirs)`;
        for (const pkgId of otherPkgs) importEdges.push({ id: `imp:${gid}->${pkgId}`, source: gid, target: pkgId, kind: "IMPORTS" });
      } else if (hasOther) {
        // expanded other -> individual files for other dirs
        for (const fi of rel.filter((f) => !topDirs.has(dirOf(f.file)))) {
          const pkgId = pkgIdOf(fi);
          importEdges.push({ id: `imp:file:${fi.file}:${fi.line}->${pkgId}`, source: `file:${fi.file}:${fi.line}:${fi.pkgName}`, target: pkgId, kind: "IMPORTS" });
        }
      }
      // Add individual files for expanded groups
      for (const [dir] of groups) if (expanded.has(`file-group:${dir}`)) {
        for (const fi of rel.filter((f) => dirOf(f.file) === dir)) {
          const pkgId = pkgIdOf(fi);
          importEdges.push({ id: `imp:file:${fi.file}:${fi.line}->${pkgId}`, source: `file:${fi.file}:${fi.line}:${fi.pkgName}`, target: pkgId, kind: "IMPORTS" });
        }
      }
      return [...baseEdges, ...importEdges];
    }

    return [
      ...baseEdges,
      ...rel.map((f) => {
        const pkgId = pkgIdOf(f);
        return { id: `imp:file:${f.file}:${f.line}:${f.pkgName}->${pkgId}`, source: `file:${f.file}:${f.line}:${f.pkgName}`, target: pkgId, kind: "IMPORTS" as const };
      }),
    ];
  }, [analysis, showFiles, relevantFileImports, pkgModule, expanded]);

  const modeHighlight = useHighlightSets(analysis, mode);
  const searchHighlight = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || mode) return null;
    const matching = new Set<string>();
    for (const n of analysis.nodes) {
      if (n.kind === "package" && (n.label.toLowerCase().includes(q) || (n.sub ?? "").toLowerCase().includes(q) || n.id.toLowerCase().includes(q))) matching.add(n.id);
      if (n.kind === "file" && n.label.toLowerCase().includes(q)) matching.add(n.id);
      if (n.kind === "vuln" && n.label.toLowerCase().includes(q)) matching.add(n.id);
    }
    for (const v of analysis.vulnerabilities) {
      if (v.packageName.toLowerCase().includes(q) || v.identifier.toLowerCase().includes(q) || v.version.toLowerCase().includes(q)) {
        const pn = analysis.nodes.find((x) => x.label === v.packageName);
        if (pn) matching.add(pn.id);
        matching.add(v.key);
      }
    }
    for (const f of analysis.fileImports) {
      if (f.file.toLowerCase().includes(q) || f.pkgName.toLowerCase().includes(q)) {
        const fid = nodes.find((x) => x.label === f.file)?.id;
        if (fid) matching.add(fid);
        const pn = analysis.nodes.find((x) => x.label === f.pkgName);
        if (pn) matching.add(pn.id);
      }
    }
    if (matching.size === 0) return null;
    const nodesSet = new Set<string>(matching);
    const edgesSet = new Set<string>();
    for (const id of [...matching]) {
      for (const e of analysis.edges) {
        if (e.source === id) { nodesSet.add(e.target); edgesSet.add(e.id); }
        if (e.target === id) { nodesSet.add(e.source); edgesSet.add(e.id); }
      }
      const node = analysis.nodes.find((n) => n.id === id);
      const vuln = analysis.vulnerabilities.find((v) => v.packageName === node?.label || v.key === id);
      if (vuln) {
        for (const p of vuln.blastRadius.pathNodeIds) {
          for (const nid of p) nodesSet.add(nid);
          for (let i = 0; i < p.length - 1; i++) {
            const e = analysis.edges.find((x) => x.source === p[i] && x.target === p[i + 1]);
            if (e) edgesSet.add(e.id);
          }
        }
        nodesSet.add(vuln.key);
        const pn2 = analysis.nodes.find((x) => x.label === vuln.packageName);
        if (pn2) nodesSet.add(pn2.id);
      }
      for (const f of analysis.fileImports) if (f.pkgName === node?.label) {
        const fid = nodes.find((x) => x.label === f.file)?.id;
        if (fid) { nodesSet.add(fid); }
      }
    }
    // If package inside collapsed module, highlight module instead
    if (pkgModule) {
      for (const [modId, pkgs] of pkgModule.groups) {
        const gid = `module:${modId}`;
        if (expanded.has(gid)) continue;
        if (pkgs.some((p) => matching.has(p.id))) {
          nodesSet.add(gid);
        }
      }
    }
    // file-group
    for (const n of nodes) if (n.id.startsWith("file-group:") && n.label.toLowerCase().includes(q)) nodesSet.add(n.id);
    return { nodes: nodesSet, edges: edgesSet };
  }, [analysis, query, mode, nodes, expanded, pkgModule]);
  const highlight = (modeHighlight as unknown as { nodes: Set<string>; edges: Set<string> } | null) ?? searchHighlight;

  // Auto-expand modules/file-groups that contain search matches so they become visible
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q || mode) return;
    const toExpand = new Set<string>();
    if (pkgModule) {
      for (const [modId, pkgs] of pkgModule.groups) {
        const gid = `module:${modId}`;
        if (expanded.has(gid)) continue;
        if (pkgs.some((p) => p.label.toLowerCase().includes(q) || (p.sub ?? "").toLowerCase().includes(q))) toExpand.add(gid);
      }
    }
    // file groups
    for (const n of nodes) {
      if (n.id.startsWith("file-group:") && n.label.toLowerCase().includes(q)) toExpand.add(n.id);
    }
    if (toExpand.size) setExpanded((prev) => new Set([...prev, ...toExpand]));
  }, [query, mode, pkgModule, nodes, expanded]);

  function select(id: string | null) {
    if (!id) { setSelectedId(null); return; }
    if (id.startsWith("file-group:") || id.startsWith("module:")) {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      setSelectedId(id);
      setFocusTarget({ nodeId: id, seq: Date.now() });
      return;
    }
    setSelectedId(id);
    if (id && !id.startsWith("vuln-") && mode?.type !== undefined) {
      const isVulnPick = analysis.vulnerabilities.some((v) => v.key === id);
      if (!isVulnPick) setMode(null);
    }
    if (id) {
      setFocusTarget({ nodeId: id, seq: Date.now() });
      const v = analysis.vulnerabilities.find((x) => x.key === id);
      if (v) setMode({ type: "blast", vulnKey: v.key });
    }
  }

  function exploreBlast(vulnKey: string) {
    setSelectedId(vulnKey);
    setMode(mode?.type === "blast" && mode.vulnKey === vulnKey ? null : { type: "blast", vulnKey });
    setFocusTarget({ nodeId: vulnKey, seq: Date.now() });
  }

  const fileCount = analysis.fileImports.length;
  const showingFiles = showFiles ? relevantFileImports.length : 0;
  const moduleCount = pkgModule ? pkgModule.groups.size : 0;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="z-20 flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 hover:opacity-75">
          <Mark />
          <span className="font-display text-[15px] font-semibold tracking-tight">DepGraph</span>
        </Link>
        <div className="hidden min-w-0 items-center gap-2 border-l border-line pl-4 md:flex">
          <span className="truncate font-mono text-xs font-medium text-ink">{analysis.name}</span>
          <span className="truncate font-mono text-[10.5px] text-faint">{analysis.repositoryUrl.replace("https://github.com/", "")}</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <label className="relative hidden sm:block">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2.4" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5" strokeLinecap="round" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search packages, files, CVE…" aria-label="Search packages, files, CVE" spellCheck={false} className="h-9 w-56 border border-line-strong bg-bg pl-8 pr-3 font-mono text-xs text-ink placeholder:text-faint focus:border-link focus:outline-none lg:w-64" />
          </label>
          {moduleCount > 1 && (
            <button onClick={() => setGroupByModule((v) => !v)} className={`hidden h-9 items-center gap-1.5 border px-2.5 font-mono text-[11px] md:flex ${groupByModule ? "border-link bg-link-soft text-link" : "border-line-strong text-muted hover:text-ink"}`} title={groupByModule ? `Grouped into ${moduleCount} modules` : "Ungrouped"}>
              modules {groupByModule ? `· ${moduleCount}` : ""}
            </button>
          )}
          <button onClick={() => setShowFiles((s) => !s)} className={`hidden h-9 items-center gap-1.5 border px-2.5 font-mono text-[11px] md:flex ${showFiles ? "border-link bg-link-soft text-link" : "border-line-strong text-muted hover:text-ink"}`} title={showFiles ? `Showing ${showingFiles}/${fileCount} files` : `Show ${fileCount} files`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>
            files {showFiles ? `· ${showingFiles}` : ""}
          </button>
          <span className="flex items-center gap-1.5 border border-line-strong bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-muted"><span className="h-1.5 w-1.5 rounded-full bg-ok" />complete</span>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1">
            <LeftPanel analysis={analysis} query={query} selectedId={selectedId} onSelectPackage={select} />
            <main className="grid-backdrop relative min-w-0 flex-1">
              <GraphCanvas nodes={nodes} edges={edges} selectedId={selectedId} pathNodes={highlight?.nodes ?? new Set()} pathEdges={highlight?.edges ?? new Set()} highlightActive={!!highlight} onSelect={select} focusTarget={focusTarget} />
              {showFiles && relevantFileImports.length > FILE_GROUP_THRESHOLD && <div className="pointer-events-none absolute left-4 top-4 max-w-[280px] border border-line bg-surface/95 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-muted shadow-sm backdrop-blur">File volume high ({fileCount} imports → {relevantFileImports.length} shown). Grouped by dir ({nodes.filter((n) => n.id.startsWith("file-group:")).length} groups). Click group to expand. Filter via search or select package.</div>}
              {pkgModule && !groupByModule && <div className="pointer-events-none absolute left-4 top-4 border border-line bg-surface/95 px-2 py-1 font-mono text-[10px] text-faint">Module grouping off — showing {analysis.nodes.filter((n) => n.kind === "package").length} packages</div>}
              {pkgModule && groupByModule && <div className="pointer-events-none absolute left-4 bottom-14 border border-line bg-surface/95 px-3 py-1.5 font-mono text-[10.5px] text-muted">Modules: {moduleCount} (click module to expand, toggle top bar)</div>}
            </main>
            <DetailsPanel analysis={analysis} selectedId={selectedId} highlight={highlight} onExploreBlast={exploreBlast} onFindDependents={(id) => setMode(mode?.type === "neighbors" && mode.id === id && mode.dir === "in" ? null : { type: "neighbors", id, dir: "in" })} onFindDependencies={(id) => setMode(mode?.type === "neighbors" && mode.id === id && mode.dir === "out" ? null : { type: "neighbors", id, dir: "out" })} mode={mode?.type === "blast" ? `blast:${mode.vulnKey}` : mode ? `${mode.dir}:${mode.id}` : null} />
      </div>
    </div>
  );
}

function Mark() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <circle cx="4" cy="16" r="2.6" fill="var(--link)" />
      <circle cx="16" cy="4" r="2.6" fill="var(--accent)" />
      <path d="M5.5 14 L14.5 5.8" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
