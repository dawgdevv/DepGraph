"use client";

import { useMemo } from "react";
import type { Analysis, GraphEdge, GraphNode, Vulnerability } from "@/lib/demo-data";
import { dependentsOf, dependenciesOf, filesImporting } from "@/lib/demo-data";

type Highlight = { nodes: Set<string>; edges: Set<string> };

export function LeftPanel({
  analysis,
  query,
  selectedId,
  onSelectPackage,
}: {
  analysis: Analysis;
  query: string;
  selectedId: string | null;
  onSelectPackage: (id: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const packages = analysis.nodes.filter((n) => n.kind === "package");
  const matches = q
    ? packages.filter(
        (p) =>
          p.label.toLowerCase().includes(q) ||
          (p.sub ?? "").toLowerCase().includes(q)
      )
    : [];

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
          {q ? `Results · ${matches.length}` : `Vulnerable packages · ${analysis.vulnerabilities.length}`}
        </h2>
      </div>

      {q && (
        <div className="border-b border-line pb-2">
          {matches.length === 0 ? (
            <p className="px-4 py-4 text-xs leading-relaxed text-muted">
              No packages match “{query.trim()}”.
            </p>
          ) : (
            matches.map((p) => {
              const vuln = analysis.vulnerabilities.find(
                (v) => v.packageName === p.label
              );
              return (
                <button
                  key={p.id}
                  onClick={() => onSelectPackage(p.id)}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-bg ${
                    selectedId === p.id ? "bg-link-soft" : ""
                  }`}
                >
                  <span>
                    <span className="block font-mono text-[12.5px] font-medium text-ink">
                      {p.label}
                    </span>
                    <span className="block font-mono text-[10.5px] text-faint">
                      v{p.sub} · {p.isDirect ? "direct" : "transitive"}
                    </span>
                  </span>
                  {vuln && (
                    <span
                      className={`px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase ${
                        vuln.severity === "high"
                          ? "bg-accent text-white"
                          : "bg-accent-soft text-accent-ink"
                      }`}
                    >
                      {vuln.severity}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}

      {!q &&
        analysis.vulnerabilities.map((v) => {
          const active = selectedId === v.key;
          return (
            <button
              key={v.key}
              onClick={() => onSelectPackage(v.key)}
              className={`group border-b border-line px-4 py-3.5 text-left transition-colors ${
                active ? "bg-accent-soft/60" : "hover:bg-bg"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[13px] font-semibold text-ink">
                    {v.packageName}
                  </p>
                  <p className="font-mono text-[10.5px] text-faint">v{v.version}</p>
                </div>
                <SeverityBadge severity={v.severity} />
              </div>
              <div className="mt-2.5 flex items-center gap-3 font-mono text-[10.5px] text-muted">
                <span>{v.blastRadius.dependencyPaths} paths</span>
                <span>{v.blastRadius.dependentPackages} dependents</span>
                <span className="ml-auto text-link opacity-0 transition-opacity group-hover:opacity-100">
                  explore →
                </span>
              </div>
            </button>
          );
        })}

      {!q && analysis.vulnerabilities.length === 0 && (
        <div className="px-4 py-6">
          <p className="text-sm font-medium">No vulnerabilities found.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Your dependency tree contains no findings from the current scan.
          </p>
        </div>
      )}

      <div className="mt-auto border-t border-line px-4 py-3 font-mono text-[10.5px] leading-relaxed text-faint">
        {analysis.stats.packages} packages · {analysis.stats.direct} direct ·{" "}
        {analysis.stats.transitive} transitive
        <br />
        showing core subgraph
        <span className="mt-1.5 flex items-center gap-1.5 text-muted">
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
            <ellipse cx="5" cy="2.4" rx="4" ry="1.7" fill="none" stroke="currentColor" strokeWidth="1.1" />
            <path d="M1 2.4 V7.6 A4 1.7 0 0 0 9 7.6 V2.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
          </svg>
          powered by CognoDB
        </span>
      </div>
    </aside>
  );
}

export function SeverityBadge({ severity }: { severity: Vulnerability["severity"] }) {
  return (
    <span
      className={`shrink-0 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide ${
        severity === "high"
          ? "bg-accent text-white"
          : "bg-accent-soft text-accent-ink"
      }`}
    >
      {severity}
    </span>
  );
}

export function DetailsPanel({
  analysis,
  selectedId,
  highlight,
  onExploreBlast,
  onFindDependents,
  onFindDependencies,
  mode,
}: {
  analysis: Analysis;
  selectedId: string | null;
  highlight: Highlight | null;
  onExploreBlast: (vulnKey: string) => void;
  onFindDependents: (id: string) => void;
  onFindDependencies: (id: string) => void;
  mode: string | null;
}) {
  const node = analysis.nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <aside className="hidden h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface lg:flex">
      {!node && (
        <div className="flex flex-1 flex-col justify-center px-6">
          <p className="font-display text-sm font-semibold text-ink">
            Nothing selected
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            Click a node in the graph or pick a vulnerable package to inspect its
            relationships.
          </p>
        </div>
      )}
      {node && <DetailBody
        analysis={analysis}
        node={node}
        highlight={highlight}
        onExploreBlast={onExploreBlast}
        onFindDependents={onFindDependents}
        onFindDependencies={onFindDependencies}
        mode={mode}
      />}
    </aside>
  );
}

function DetailBody({
  analysis,
  node,
  highlight,
  onExploreBlast,
  onFindDependents,
  onFindDependencies,
  mode,
}: {
  analysis: Analysis;
  node: GraphNode;
  highlight: Highlight | null;
  onExploreBlast: (vulnKey: string) => void;
  onFindDependents: (id: string) => void;
  onFindDependencies: (id: string) => void;
  mode: string | null;
}) {
  if (node.kind === "project") {
    return (
      <div className="px-5 py-4">
        <KindTag>Project</KindTag>
        <h3 className="mt-2 font-display text-xl font-semibold tracking-tight">
          {node.label}
        </h3>
        <p className="mt-0.5 break-all font-mono text-[11px] text-faint">
          {analysis.repositoryUrl}
        </p>
        <dl className="mt-5 space-y-2.5 border-t border-line pt-4 font-mono text-xs">
          <Row k="packages" v={String(analysis.stats.packages)} />
          <Row k="direct deps" v={String(analysis.stats.direct)} />
          <Row k="transitive" v={String(analysis.stats.transitive)} />
          <Row k="vulnerable" v={String(analysis.vulnerabilities.length)} accent />
          <Row k="affected paths" v={String(analysis.stats.affectedPaths)} accent />
        </dl>
      </div>
    );
  }

  if (node.kind === "vuln") {
    const v = analysis.vulnerabilities.find((x) => x.key === node.id);
    if (!v) return null;
    return (
      <div className="px-5 py-4">
        <KindTag>Vulnerability</KindTag>
        <div className="mt-2 flex items-center gap-2">
          <h3 className="font-display text-lg font-semibold">{node.label}</h3>
          <SeverityBadge severity={v.severity} />
        </div>
        <p className="mt-0.5 font-mono text-xs text-muted">
          {v.packageName}@{v.version}
        </p>
        <dl className="mt-4 space-y-2.5 border-t border-line pt-4 font-mono text-xs">
          <Row k="affected range" v={v.affectedRange} />
          <Row k="detected by" v="CVE-Lite" />
        </dl>
        <h4 className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
          Blast radius
        </h4>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <Stat label="dependent pkgs" value={v.blastRadius.dependentPackages} />
          <Stat label="paths" value={v.blastRadius.dependencyPaths} />
          <Stat label="direct" value={v.blastRadius.directPaths} />
          <Stat label="transitive" value={v.blastRadius.transitivePaths} />
        </dl>
        <button
          onClick={() => onExploreBlast(v.key)}
          disabled={mode === `blast:${v.key}`}
          className={`mt-4 w-full border px-3 py-2 font-display text-sm font-medium transition-colors ${
            mode === `blast:${v.key}`
              ? "border-accent bg-accent text-white"
              : "border-accent bg-transparent text-accent-ink hover:bg-accent-soft"
          }`}
        >
          {mode === `blast:${v.key}` ? "Showing blast radius" : "View blast radius"}
        </button>
      </div>
    );
  }

  if (node.kind === "file") {
    const imports = analysis.fileImports.filter((f) => f.file === node.label);
    return (
      <div className="px-5 py-4">
        <KindTag>File</KindTag>
        <h3 className="mt-2 break-all font-mono text-sm font-semibold">{node.label}</h3>
        <h4 className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
          Imports
        </h4>
        <ul className="mt-2 space-y-1.5 font-mono text-xs">
          {imports.map((f) => (
            <li key={`${f.pkgId}:${f.line}`} className="text-muted">
              → {f.pkgName} <span className="text-faint">L{f.line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-faint">
          File-level import reachability — not proof of execution.
        </p>
      </div>
    );
  }

  const deps = dependenciesOf(analysis, node.id);
  const dependents = dependentsOf(analysis, node.id);
  const reachIds = [node.id, ...dependents];
  const files = filesImporting(analysis, reachIds);
  const vulns = analysis.vulnerabilities.filter((v) =>
    deps.concat([node.id]).includes(v.packageName)
  );

  return (
    <div className="px-5 py-4">
      <KindTag>Package{node.isDirect ? " · direct dep" : ""}</KindTag>
      <h3 className="mt-2 font-display text-lg font-semibold tracking-tight">
        {node.label}
      </h3>
      <p className="font-mono text-xs text-faint">v{node.sub}</p>

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4">
        <Stat label="deps" value={deps.length} />
        <Stat label="dependents" value={dependents.length} />
        <Stat label="vulns" value={vulns.length} danger={vulns.length > 0} />
      </dl>

      {vulns.length > 0 && (
        <div className="mt-4 space-y-2">
          {vulns.map((v) => (
            <div
              key={v.key}
              className="flex items-center justify-between border border-accent/40 bg-accent-soft/50 px-3 py-2"
            >
              <div>
                <p className="font-mono text-xs font-semibold text-accent-ink">
                  {v.identifier}
                </p>
                <p className="font-mono text-[10px] text-accent-ink/70">
                  {v.packageName}@{v.version}
                </p>
              </div>
              <button
                onClick={() => onExploreBlast(v.key)}
                className="border border-accent px-2 py-1 font-mono text-[10px] font-medium text-accent-ink hover:bg-accent hover:text-white"
              >
                blast radius
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex gap-1.5">
        <MiniAction
          active={mode === `out:${node.id}`}
          onClick={() => onFindDependencies(node.id)}
        >
          dependencies
        </MiniAction>
        <MiniAction
          active={mode === `in:${node.id}`}
          onClick={() => onFindDependents(node.id)}
        >
          dependents
        </MiniAction>
      </div>

      <h4 className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
        Dependencies
      </h4>
      <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
        {deps.map((d) => {
          const dn = analysis.nodes.find((n) => n.id === d);
          return (
            <li key={d}>→ {dn ? `${dn.label}@${dn.sub}` : d}</li>
          );
        })}
        {deps.length === 0 && <li className="text-faint">none</li>}
      </ul>

      <h4 className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
        Used by
      </h4>
      <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
        {dependents.map((d) => {
          const dn = analysis.nodes.find((n) => n.id === d);
          return <li key={d}>← {dn ? `${dn.label}${dn.kind === "project" ? "" : `@${dn.sub}`}` : d}</li>;
        })}
        {dependents.length === 0 && <li className="text-faint">nothing depends on this</li>}
      </ul>

      <h4 className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
        Importing files
      </h4>
      <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
        {files.map((f) => (
          <li key={`${f.file}:${f.line}`}>
            {f.file} <span className="text-faint">L{f.line}</span>
          </li>
        ))}
        {files.length === 0 && <li className="text-faint">none in this subgraph</li>}
      </ul>

      {highlight && (
        <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-faint">
          File-level import reachability — not proof that vulnerable code executes.
        </p>
      )}
    </div>
  );
}

function KindTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block border border-line-strong bg-bg px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">
      {children}
    </span>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-faint">{k}</dt>
      <dd className={accent ? "font-semibold text-accent-ink" : "text-ink"}>{v}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="border border-line bg-bg px-2.5 py-2">
      <dd
        className={`font-mono text-lg font-semibold leading-none ${
          danger ? "text-accent-ink" : "text-ink"
        }`}
      >
        {value}
      </dd>
      <dt className="mt-1 font-mono text-[9.5px] uppercase tracking-wide text-faint">
        {label}
      </dt>
    </div>
  );
}

function MiniAction({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 border px-2 py-1.5 font-mono text-[10.5px] transition-colors ${
        active
          ? "border-link bg-link-soft text-link"
          : "border-line-strong text-muted hover:border-link hover:text-link"
      }`}
    >
      {children}
    </button>
  );
}

export function useHighlightSets(
  analysis: Analysis,
  mode: { type: "blast"; vulnKey: string } | { type: "neighbors"; id: string; dir: "in" | "out" } | null
): Highlight | null {
  return useMemo(() => {
    if (!mode) return null;
    if (mode.type === "blast") {
      const v = analysis.vulnerabilities.find((x) => x.key === mode.vulnKey);
      if (!v) return null;
      const nodes = new Set<string>([v.key]);
      const edges = new Set<string>();
      for (const path of v.blastRadius.pathNodeIds) {
        path.forEach((id) => nodes.add(id));
        for (let i = 0; i < path.length - 1; i++) {
          const e: GraphEdge | undefined = analysis.edges.find(
            (x) => x.source === path[i] && x.target === path[i + 1]
          );
          if (e) edges.add(e.id);
        }
      }
      return { nodes, edges };
    }
    const { id, dir } = mode;
    const rel = analysis.edges.filter((e) =>
      dir === "in" ? e.target === id : e.source === id
    );
    return {
      nodes: new Set([id, ...rel.map((e) => (dir === "in" ? e.source : e.target))]),
      edges: new Set(rel.map((e) => e.id)),
    };
  }, [analysis, mode]);
}
