"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AnalysisRecord } from "@/lib/analysis-store";
import Explorer from "./explorer/explorer";
import type { Analysis } from "@/lib/graph";

const STATUS_ORDER: AnalysisRecord["status"][] = [
  "queued",
  "cloning",
  "parsing",
  "scanning",
  "building_graph",
  "complete",
];

const STAGES = [
  "Repository loaded",
  "package.json detected",
  "package-lock.json detected",
  "Dependencies parsed",
  "Vulnerability scan completed",
  "Dependency graph built",
];

function stageFor(status: AnalysisRecord["status"]): number {
  switch (status) {
    case "queued":
      return 0;
    case "cloning":
      return 1;
    case "parsing":
      return 3;
    case "scanning":
      return 4;
    case "building_graph":
      return 5;
    case "complete":
      return STAGES.length;
    case "failed":
      return -1;
    default:
      return 0;
  }
}

export default function AnalysisPoller({ id }: { id: string }) {
  const [record, setRecord] = useState<AnalysisRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<Analysis | null>(null);
  const [graphErr, setGraphErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/analyses/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as AnalysisRecord & { error?: string };
        if (!res.ok) {
          if (!cancelled) setError((data as { error?: string }).error ?? "We couldn't find this analysis.");
          return;
        }
        if (cancelled) return;
        setRecord(data);
        if (data.status === "complete" || data.status === "failed") return;
        timer = setTimeout(poll, 1200);
      } catch {
        if (!cancelled) setError("The analysis service is temporarily unavailable. Please try again.");
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  // Fetch real CognoDB graph once record is complete
  useEffect(() => {
    if (!record || record.status !== "complete") return;
    let cancelled = false;
    async function loadGraph() {
      try {
        const res = await fetch(`/api/graph/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          const msg =
            res.status === 404
              ? (d.error ?? "We couldn't find this analysis graph. Graph write may have failed.")
              : (d.error ?? "We couldn't load the dependency graph.");
          if (!cancelled) setGraphErr(msg);
          return;
        }
        const data = (await res.json()) as Analysis;
        if (!cancelled) setGraph(data);
      } catch {
        if (!cancelled) setGraphErr("The dependency graph is temporarily unavailable. Please try again.");
      }
    }
    loadGraph();
    return () => {
      cancelled = true;
    };
  }, [id, record]);

  if (error) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center bg-bg px-6">
        <p className="font-mono text-xs uppercase tracking-wide text-accent-ink">Analysis failed</p>
        <p className="mt-3 max-w-md text-center text-sm leading-relaxed text-muted">{error}</p>
        <Link href="/" className="mt-6 border border-line-strong bg-surface px-4 py-2 font-mono text-xs hover:bg-bg">
          ← Try another repository
        </Link>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <p className="font-mono text-xs text-faint">Loading…</p>
      </div>
    );
  }

  if (record.status === "failed") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center bg-bg px-6">
        <p className="font-mono text-xs uppercase tracking-wide text-accent-ink">Analysis failed</p>
        <p className="mt-3 max-w-md text-center text-sm leading-relaxed text-muted">
          {record.error ?? "We couldn't analyze this repository."}
        </p>
        <Link href="/" className="mt-6 border border-line-strong bg-surface px-4 py-2 font-mono text-xs hover:bg-bg">
          ← Try another repository
        </Link>
      </div>
    );
  }

  if (record.status !== "complete") {
    const stage = stageFor(record.status);
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <header className="flex h-14 items-center gap-4 border-b border-line bg-surface px-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="font-display text-[15px] font-semibold">DepGraph</span>
          </Link>
          <span className="ml-auto flex items-center gap-1.5 border border-accent/40 bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-accent-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" /> {record.status}
          </span>
        </header>
        <div className="flex w-full flex-1 items-center justify-center">
          <div className="w-full max-w-sm px-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
              Analyzing {record.repoPath} — {record.status}
            </p>
            <ul className="mt-4 space-y-2.5">
              {STAGES.map((s, i) => (
                <li
                  key={s}
                  className={`flex items-center gap-2.5 font-mono text-[13px] ${
                    i < stage ? "text-ink" : i === stage ? "text-ink" : "text-faint opacity-40"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center border text-[9px] ${
                      i < stage
                        ? "border-ok bg-ok text-white"
                        : i === stage
                          ? "border-link text-link"
                          : "border-line-strong"
                    }`}
                  >
                    {i < stage ? "✓" : ""}
                  </span>
                  {s}
                </li>
              ))}
            </ul>
            <p className="mt-6 font-mono text-[11px] text-faint">Polling /api/analyses/{id}…</p>
          </div>
        </div>
      </div>
    );
  }

  if (graphErr) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center bg-bg px-6">
        <p className="font-mono text-xs uppercase tracking-wide text-accent-ink">Graph unavailable</p>
        <p className="mt-3 max-w-md text-center text-sm leading-relaxed text-muted">{graphErr}</p>
        <Link href="/" className="mt-6 border border-line-strong bg-surface px-4 py-2 font-mono text-xs hover:bg-bg">
          ← Try another repository
        </Link>
      </div>
    );
  }
  if (!graph) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <p className="font-mono text-xs text-faint">Loading graph…</p>
      </div>
    );
  }
  return <Explorer analysis={graph} />;
}
