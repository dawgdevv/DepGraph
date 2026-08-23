"use client";

import { useMemo } from "react";
import type { Analysis, GraphEdge, GraphNode, Vulnerability } from "@/lib/graph";
import { dependentsOf, dependenciesOf, filesImporting } from "@/lib/graph";

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
  const fileNodes = analysis.nodes.filter((n) => n.kind === "file");
  const packageMatches = q
    ? packages.filter(
        (p) =>
          p.label.toLowerCase().includes(q) ||
          (p.sub ?? "").toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q)
      )
    : [];
  const vulnMatches = q
    ? analysis.vulnerabilities.filter(
        (v) =>
          v.packageName.toLowerCase().includes(q) ||
          v.identifier.toLowerCase().includes(q) ||
          v.version.toLowerCase().includes(q) ||
          v.severity.toLowerCase().includes(q)
      )
    : [];
  // file search: match file path or imported package name
  const fileMatches = q
    ? (() => {
        const seen = new Set<string>();
        const out: Array<{ id: string; label: string; pkgName: string; line: number }> = [];
        // from file nodes
        for (const fn of fileNodes) {
          if (fn.label.toLowerCase().includes(q)) {
            // find one import for sub display
            const imp = analysis.fileImports.find((fi) => fi.file === fn.label);
            const key = fn.id;
            if (!seen.has(key)) {
              seen.add(key);
              out.push({ id: fn.id, label: fn.label, pkgName: imp?.pkgName ?? "", line: imp?.line ?? 0 });
            }
          }
        }
        // also from fileImports directly (covers when file nodes not yet created)
        for (const fi of analysis.fileImports) {
          if (fi.file.toLowerCase().includes(q) || fi.pkgName.toLowerCase().includes(q)) {
            const fid = analysis.nodes.find((n) => n.kind === "file" && n.label === fi.file)?.id ?? `file:${fi.file}`;
            if (!seen.has(fid)) {
              seen.add(fid);
              out.push({ id: fid, label: fi.file, pkgName: fi.pkgName, line: fi.line });
            }
          }
        }
        return out;
      })()
    : [];
  const totalMatches = packageMatches.length + vulnMatches.length + fileMatches.length;

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
          {q
            ? `Results · ${totalMatches} (${packageMatches.length} pkg · ${vulnMatches.length} vuln · ${fileMatches.length} file)`
            : `Vulnerable packages · ${analysis.vulnerabilities.length}`}
        </h2>
        {q && (
          <p className="mt-1 font-mono text-[10px] text-faint">
            Search packages, vulns, files — click to focus graph. For compromised pkg, view blast radius in details.
          </p>
        )}
      </div>

      {q && (
        <div className="border-b border-line pb-2">
          {totalMatches === 0 ? (
            <p className="px-4 py-4 text-xs leading-relaxed text-muted">
              No match for “{query.trim()}”. Try package name, file path, or CVE id.
            </p>
          ) : (
            <>
              {packageMatches.length > 0 && (
                <div>
                  <p className="px-4 pt-2 font-mono text-[10px] uppercase tracking-wide text-faint">Packages · {packageMatches.length}</p>
                  {packageMatches.map((p) => {
                    const vuln = analysis.vulnerabilities.find((v) => v.packageName === p.label);
                    return (
                      <button
                        key={p.id}
                        onClick={() => onSelectPackage(p.id)}
                        className={`flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-bg ${selectedId === p.id ? "bg-link-soft" : ""}`}
                      >
                        <span>
                          <span className="block font-mono text-[12.5px] font-medium text-ink">{p.label}</span>
                          <span className="block font-mono text-[10.5px] text-faint">v{p.sub} · {p.isDirect ? "direct" : "transitive"}</span>
                        </span>
                        {vuln && <span className={`px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase ${vuln.severity === "high" ? "bg-accent text-white" : "bg-accent-soft text-accent-ink"}`}>{vuln.severity}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {vulnMatches.length > 0 && (
                <div className="border-t border-line/60">
                  <p className="px-4 pt-2 font-mono text-[10px] uppercase tracking-wide text-faint">Vulnerabilities · {vulnMatches.length}</p>
                  {vulnMatches.map((v) => (
                    <button
                      key={v.key}
                      onClick={() => onSelectPackage(v.key)}
                      className={`flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-bg ${selectedId === v.key ? "bg-accent-soft/60" : ""}`}
                    >
                      <span>
                        <span className="block font-mono text-[12.5px] font-medium text-ink">{v.identifier}</span>
                        <span className="block font-mono text-[10.5px] text-faint">{v.packageName}@{v.version}</span>
                      </span>
                      <span className={`px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase ${v.severity === "high" ? "bg-accent text-white" : "bg-accent-soft text-accent-ink"}`}>{v.severity}</span>
                    </button>
                  ))}
                </div>
              )}
              {fileMatches.length > 0 && (
                <div className="border-t border-line/60">
                  <p className="px-4 pt-2 font-mono text-[10px] uppercase tracking-wide text-faint">Files · {fileMatches.length}</p>
                  {fileMatches.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => onSelectPackage(f.id)}
                      className={`flex w-full flex-col px-4 py-2 text-left hover:bg-bg ${selectedId === f.id ? "bg-link-soft" : ""}`}
                    >
                      <span className="block truncate font-mono text-[12px] text-ink">{f.label}</span>
                      <span className="block font-mono text-[10.5px] text-faint">→ {f.pkgName} L{f.line}</span>
                    </button>
                  ))}
                  <p className="px-4 py-1 font-mono text-[10px] text-faint">File → Package → Vulnerability. Select file to see its imports and reachability.</p>
                </div>
              )}
            </>
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
    const pkgNode = analysis.nodes.find((n) => n.label === v.packageName);
    const blastPkgIds = v.blastRadius.pathNodeIds.length
      ? [...new Set(v.blastRadius.pathNodeIds.flat().filter((id) => analysis.nodes.some((n) => n.id === id && n.kind === "package")))]
      : [];
    const fileSearchIds = [pkgNode?.id, ...blastPkgIds].filter(Boolean) as string[];
    const files = filesImporting(analysis, fileSearchIds.length ? fileSearchIds : [v.packageName]);
    return (
      <div className="px-5 py-4">
        <KindTag>Vulnerability</KindTag>
        <div className="mt-2 flex items-center gap-2">
          <h3 className="font-display text-lg font-semibold">{node.label}</h3>
          <SeverityBadge severity={v.severity} />
        </div>
        <p className="mt-0.5 font-mono text-xs text-muted">
          {v.packageName}@{v.version} {v.relationship ? `· ${v.relationship}` : ""}
        </p>
        {v.summary && <p className="mt-3 text-xs leading-relaxed text-muted">{v.summary}</p>}
        <dl className="mt-4 space-y-2.5 border-t border-line pt-4 font-mono text-xs">
          <Row k="affected range" v={v.affectedRange || "unknown"} />
          {v.fixVersion && <Row k="fixed in" v={v.fixVersion} accent />}
          <Row k="primary parent" v={v.primaryParent ?? "—"} />
          <Row k="relationship" v={v.relationship ?? "transitive"} />
          <Row k="detected by" v="CVE-Lite" />
        </dl>
        {v.cves && v.cves.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {v.cves.map((c) => (
              <span key={c} className="border border-line-strong bg-bg px-1.5 py-0.5 font-mono text-[10px] text-muted">{c}</span>
            ))}
          </div>
        )}
        <h4 className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">Blast radius</h4>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <Stat label="dependent pkgs" value={v.blastRadius.dependentPackages} />
          <Stat label="paths" value={v.blastRadius.dependencyPaths} />
          <Stat label="direct" value={v.blastRadius.directPaths} />
          <Stat label="transitive" value={v.blastRadius.transitivePaths} />
        </dl>
        <button onClick={() => onExploreBlast(v.key)} disabled={mode === `blast:${v.key}`} className={`mt-4 w-full border px-3 py-2 font-display text-sm font-medium transition-colors ${mode === `blast:${v.key}` ? "border-accent bg-accent text-white" : "border-accent bg-transparent text-accent-ink hover:bg-accent-soft"}`}>{mode === `blast:${v.key}` ? "Showing blast radius" : "View blast radius"}</button>

        {(v.blastRadius.pathNodeIds.length > 0 || (v.dependencyPaths && v.dependencyPaths.length > 0)) && (
          <div className="mt-4 border-t border-line pt-4">
            <h4 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">Dependency paths</h4>
            <div className="mt-2 space-y-2">
              {(v.blastRadius.pathNodeIds.length > 0 ? v.blastRadius.pathNodeIds : (v.dependencyPaths ?? [])).slice(0, 6).map((path, idx) => {
                const labels = path.map((id) => {
                  const n = analysis.nodes.find((x) => x.id === id);
                  return n ? n.label : id.replace(/^.*:/, "").replace(/^.*--/, "");
                });
                const display = labels.join(" → ");
                return (
                  <div key={idx} className="border border-line bg-bg px-2.5 py-2">
                    <p className="font-mono text-[11px] leading-relaxed text-ink">{display} <span className="text-accent">↘ {v.packageName}</span></p>
                    <p className="mt-1 font-mono text-[10px] text-faint">{path.length} hops {v.blastRadius.pathNodeIds.length ? "" : "· from OSV"} </p>
                  </div>
                );
              })}
              {(v.blastRadius.pathNodeIds.length > 6 || (v.dependencyPaths && v.dependencyPaths.length > 6)) && <p className="font-mono text-[10px] text-faint">+{Math.max(v.blastRadius.pathNodeIds.length, v.dependencyPaths?.length ?? 0) - 6} more paths</p>}
            </div>
          </div>
        )}

        {(v.recommendedAction || v.runnableFixCommand) && (
          <div className="mt-4 border-t border-line pt-4">
            <h4 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">Fix</h4>
            {v.recommendedAction && <p className="mt-2 text-xs leading-relaxed text-muted">{v.recommendedAction}</p>}
            {v.runnableFixCommand && (
              <div className="mt-2 flex items-center gap-2 border border-line-strong bg-bg px-2.5 py-2">
                <code className="flex-1 truncate font-mono text-[11px] text-ink">{v.runnableFixCommand}</code>
                <button onClick={() => navigator.clipboard.writeText(v.runnableFixCommand!)} className="border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted hover:text-ink">copy</button>
              </div>
            )}
            {v.fixVersion && <p className="mt-2 font-mono text-[11px] text-muted">Target: <span className="font-semibold text-ink">{v.fixVersion}</span> — update within range then run install.</p>}
          </div>
        )}

        <div className="mt-4 border-t border-line pt-4">
          <h4 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">Files importing</h4>
          {files.length > 0 ? (
            <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
              {files.slice(0, 8).map((f) => (
                <li key={`${f.file}:${f.line}`} className="truncate">→ {f.file} <span className="text-faint">L{f.line}</span></li>
              ))}
              {files.length > 8 && <li className="text-faint">+{files.length - 8} more</li>}
            </ul>
          ) : (
            <p className="mt-2 font-mono text-xs text-faint">No direct file imports found. Reachable via transitive dependencies.</p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-faint">File-level import reachability — not proof of execution.</p>
        </div>
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
