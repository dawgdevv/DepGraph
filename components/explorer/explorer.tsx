"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Analysis } from "@/lib/demo-data";
import GraphCanvas from "./graph-canvas";
import {
  DetailsPanel,
  LeftPanel,
  useHighlightSets,
} from "./panels";

const STAGES = [
  "Repository loaded",
  "package.json detected",
  "package-lock.json detected",
  "Dependencies parsed",
  "Vulnerability scan completed",
  "Dependency graph built",
];

export default function Explorer({ analysis }: { analysis: Analysis }) {
  const [stage, setStage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showFiles, setShowFiles] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{ nodeId: string; seq: number } | null>(null);
  const [mode, setMode] = useState<
    { type: "blast"; vulnKey: string } | { type: "neighbors"; id: string; dir: "in" | "out" } | null
  >(null);

  const done = stage >= STAGES.length;

  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setStage((s) => s + 1), 420);
    return () => clearTimeout(t);
  }, [stage, done]);

  const nodes = useMemo(() => {
    if (!showFiles || !done) return analysis.nodes;
    const fileNodes = analysis.fileImports.map((f, i) => {
      const pkg = analysis.nodes.find((n) => n.id === f.pkgId);
      return {
        id: `file:${i}`,
        kind: "file" as const,
        label: f.file,
        sub: f.pkgName,
        depth: Math.max(0, (pkg?.depth ?? 1) - 1),
      };
    });
    const byId = new Map(fileNodes.map((f) => [f.sub + ":" + f.label, f]));
    void byId;
    const merged = [...analysis.nodes];
    for (const fn of fileNodes) {
      if (!merged.some((m) => m.id === fn.id)) merged.push(fn);
    }
    return merged;
  }, [analysis, showFiles, done]);

  const edges = useMemo(() => {
    if (!showFiles || !done) return analysis.edges;
    const importEdges = analysis.fileImports.map((f, i) => ({
      id: `imp:${i}`,
      source: `file:${i}`,
      target: f.pkgId,
      kind: "IMPORTS" as const,
    }));
    return [...analysis.edges, ...importEdges];
  }, [analysis, showFiles, done]);

  const highlight = useHighlightSets(analysis, mode);

  function select(id: string | null) {
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
    setMode(
      mode?.type === "blast" && mode.vulnKey === vulnKey ? null : { type: "blast", vulnKey }
    );
    setFocusTarget({ nodeId: vulnKey, seq: Date.now() });
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="z-20 flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 hover:opacity-75">
          <Mark />
          <span className="font-display text-[15px] font-semibold tracking-tight">DepGraph</span>
        </Link>
        <div className="hidden min-w-0 items-center gap-2 border-l border-line pl-4 md:flex">
          <span className="truncate font-mono text-xs font-medium text-ink">{analysis.name}</span>
          <span className="truncate font-mono text-[10.5px] text-faint">
            {analysis.repositoryUrl.replace("https://github.com/", "")}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <label className="relative hidden sm:block">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2"
              width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="var(--faint)" strokeWidth="2.4" aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.5-4.5" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search packages…"
              aria-label="Search packages"
              spellCheck={false}
              className="h-9 w-56 border border-line-strong bg-bg pl-8 pr-3 font-mono text-xs text-ink placeholder:text-faint focus:border-link focus:outline-none lg:w-64"
            />
          </label>
          <button
            onClick={() => setShowFiles((s) => !s)}
            className={`hidden h-9 items-center gap-1.5 border px-2.5 font-mono text-[11px] transition-colors md:flex ${
              showFiles
                ? "border-link bg-link-soft text-link"
                : "border-line-strong text-muted hover:text-ink"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <path d="M14 3v6h6" />
            </svg>
            files
          </button>
          <span className={`flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${
            done ? "border-line-strong text-muted" : "border-accent/40 bg-accent-soft text-accent-ink"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${done ? "bg-ok" : "bg-accent pulse-dot"}`} />
            {done ? "complete" : "analyzing"}
          </span>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {done ? (
          <>
            <LeftPanel
              analysis={analysis}
              query={query}
              selectedId={selectedId}
              onSelectPackage={select}
            />
            <main className="grid-backdrop relative min-w-0 flex-1">
              <GraphCanvas
                nodes={nodes}
                edges={edges}
                selectedId={selectedId}
                pathNodes={highlight?.nodes ?? new Set()}
                pathEdges={highlight?.edges ?? new Set()}
                highlightActive={!!highlight}
                onSelect={select}
                focusTarget={focusTarget}
              />
            </main>
            <DetailsPanel
              analysis={analysis}
              selectedId={selectedId}
              highlight={highlight}
              onExploreBlast={exploreBlast}
              onFindDependents={(id) =>
                setMode(mode?.type === "neighbors" && mode.id === id && mode.dir === "in"
                  ? null
                  : { type: "neighbors", id, dir: "in" })
              }
              onFindDependencies={(id) =>
                setMode(mode?.type === "neighbors" && mode.id === id && mode.dir === "out"
                  ? null
                  : { type: "neighbors", id, dir: "out" })
              }
              mode={
                mode?.type === "blast"
                  ? `blast:${mode.vulnKey}`
                  : mode
                    ? `${mode.dir}:${mode.id}`
                    : null
              }
            />
          </>
        ) : (
          <div className="flex w-full items-center justify-center">
            <div className="w-full max-w-sm px-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
                Analyzing repository
              </p>
              <ul className="mt-4 space-y-2.5">
                {STAGES.map((s, i) => (
                  <li
                    key={s}
                    className={`flex items-center gap-2.5 font-mono text-[13px] transition-opacity ${
                      i < stage ? "text-ink" : i === stage ? "text-ink" : "text-faint opacity-40"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center border text-[9px] ${
                        i < stage
                          ? "border-ok bg-ok text-white"
                          : i === stage
                            ? "border-link text-link pulse-dot"
                            : "border-line-strong"
                      }`}
                    >
                      {i < stage ? "✓" : ""}
                    </span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
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
