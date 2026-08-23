"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { GraphEdge, GraphNode } from "@/lib/graph";

const NODE_W = 150;
const NODE_H = 46;
const V_GAP = 38;
const COL_GAP = 96;

type Transform = { x: number; y: number; k: number };

export type GraphCanvasProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  pathNodes: Set<string>;
  pathEdges: Set<string>;
  highlightActive: boolean;
  onSelect: (id: string | null) => void;
  focusTarget: { nodeId: string; seq: number } | null;
};

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export default function GraphCanvas({
  nodes,
  edges,
  selectedId,
  pathNodes,
  pathEdges,
  highlightActive,
  onSelect,
  focusTarget,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const tRef = useRef<Transform>({ x: 0, y: 0, k: 1 });
  const fittedRef = useRef(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const layout = useMemo(() => {
    const cols = new Map<number, GraphNode[]>();
    for (const n of nodes) {
      const arr = cols.get(n.depth) ?? [];
      arr.push(n);
      cols.set(n.depth, arr);
    }
    const pos = new Map<string, { x: number; y: number }>();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [depth, colNodes] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
      colNodes.sort((a, b) => a.label.localeCompare(b.label));
      const colH = colNodes.length * NODE_H + (colNodes.length - 1) * V_GAP;
      const x = depth * (NODE_W + COL_GAP);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + NODE_W);
      colNodes.forEach((n, i) => {
        const y = -colH / 2 + i * (NODE_H + V_GAP);
        pos.set(n.id, { x, y });
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y + NODE_H);
      });
    }
    if (!isFinite(minY)) { minY = -NODE_H / 2; maxY = NODE_H / 2; }
    return { pos, minX, maxX, minY, maxY };
  }, [nodes]);

  const fit = useCallback((): Transform => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0, k: 1 };
    const w = el.clientWidth;
    const h = el.clientHeight;
    const bw = Math.max(layout.maxX - layout.minX, 1);
    const bh = Math.max(layout.maxY - layout.minY, 1);
    const kx = (w - 80) / bw;
    const ky = (h - 80) / bh;
    const k = clamp(Math.min(1.05, kx, ky), 0.22, 2.4);
    const cx = (layout.minX + layout.maxX) / 2;
    const cy = (layout.minY + layout.maxY) / 2;
    return { x: w / 2 - cx * k, y: h / 2 - cy * k, k };
  }, [layout]);

  function apply(smooth: boolean) {
    const g = gRef.current;
    if (!g) return;
    const { x, y, k } = tRef.current;
    g.style.transition = smooth ? "transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)" : "none";
    g.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!fittedRef.current && entry.contentRect.width > 0 && layout.pos.size > 0) {
        fittedRef.current = true;
        tRef.current = fit();
        apply(false);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  const layoutKey = `${layout.minX}:${layout.maxX}:${layout.pos.size}`;
  const prevLayoutKey = useRef("");
  useEffect(() => {
    if (!fittedRef.current || prevLayoutKey.current === layoutKey) return;
    prevLayoutKey.current = layoutKey;
    tRef.current = fit();
    apply(true);
  }, [layoutKey, fit]);

  useEffect(() => {
    if (!focusTarget || !fittedRef.current) return;
    const p = layout.pos.get(focusTarget.nodeId);
    const el = containerRef.current;
    if (!p || !el) return;
    const k = tRef.current.k;
    tRef.current = {
      x: el.clientWidth / 2 - (p.x + NODE_W / 2) * k,
      y: el.clientHeight / 2 - (p.y + NODE_H / 2) * k,
      k,
    };
    apply(true);
  }, [focusTarget, layout]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const prev = tRef.current;
      const k = clamp(prev.k * Math.exp(-e.deltaY * 0.0016), 0.35, 2.4);
      const wx = (mx - prev.x) / prev.k;
      const wy = (my - prev.y) / prev.k;
      tRef.current = { x: mx - wx * k, y: my - wy * k, k };
      apply(false);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: tRef.current.x, oy: tRef.current.y };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.hypot(dx, dy) > 3) {
      tRef.current = { ...tRef.current, x: d.ox + dx, y: d.oy + dy };
      apply(false);
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const moved = Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3;
    if (!moved && e.target === e.currentTarget) onSelect(null);
  }

  const dim = (id: string) => highlightActive && !pathNodes.has(id);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg className="h-full w-full select-none" role="img" aria-label="Dependency graph">
        <g ref={gRef}>
          {edges.map((e) => {
            const a = layout.pos.get(e.source);
            const b = layout.pos.get(e.target);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            const hot = pathEdges.has(e.id);
            return (
              <path
                key={e.id}
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={hot ? "var(--accent)" : "var(--line-strong)"}
                strokeWidth={hot ? 2 : 1.25}
                strokeDasharray={e.kind === "IMPORTS" ? "5 4" : undefined}
                opacity={dim(e.source) && dim(e.target) ? 0.15 : hot ? 1 : 0.8}
              />
            );
          })}

          {[...layout.pos.entries()].map(([id, p]) => {
            const n = nodes.find((nd) => nd.id === id)!;
            const selected = selectedId === id;
            return (
              <g
                key={id}
                transform={`translate(${p.x}, ${p.y})`}
                opacity={dim(id) ? 0.28 : 1}
                style={{ cursor: "pointer" }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelect(id);
                }}
              >
                {selected && (
                  <rect
                    x={-4}
                    y={-4}
                    width={NODE_W + 8}
                    height={NODE_H + 8}
                    fill="none"
                    stroke="var(--link)"
                    strokeWidth={1.75}
                  />
                )}
                <NodeBody n={n} />
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute bottom-4 left-4 flex gap-1">
        <CanvasButton label="Zoom in" onClick={() => zoomStep(1.25)}>+</CanvasButton>
        <CanvasButton label="Zoom out" onClick={() => zoomStep(0.8)}>−</CanvasButton>
        <CanvasButton
          label="Reset view"
          onClick={() => {
            tRef.current = fit();
            apply(true);
          }}
        >
          reset
        </CanvasButton>
      </div>

      <div className="pointer-events-none absolute bottom-4 right-4 flex items-center gap-4 border border-line bg-surface/90 px-3 py-1.5 font-mono text-[10px] text-muted backdrop-blur-sm">
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10"><rect width="10" height="10" rx="2" fill="var(--ink)" /></svg>
          project
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10"><rect width="10" height="10" rx="2" fill="var(--surface)" stroke="var(--line-strong)" /></svg>
          package
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10"><rect width="10" height="10" rx="2" fill="var(--accent-soft)" stroke="var(--accent)" /></svg>
          vulnerability
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="14" height="6"><line x1="0" y1="3" x2="14" y2="3" stroke="var(--accent)" strokeWidth="2" /></svg>
          blast path
        </span>
      </div>

      <div className="pointer-events-none absolute top-4 right-4 font-mono text-[10px] text-faint">
        scroll to zoom · drag to pan · click to inspect
      </div>
    </div>
  );

  function zoomStep(factor: number) {
    const el = containerRef.current;
    if (!el) return;
    const prev = tRef.current;
    const k = clamp(prev.k * factor, 0.35, 2.4);
    const wx = (el.clientWidth / 2 - prev.x) / prev.k;
    const wy = (el.clientHeight / 2 - prev.y) / prev.k;
    tRef.current = { x: el.clientWidth / 2 - wx * k, y: el.clientHeight / 2 - wy * k, k };
    apply(true);
  }
}

function NodeBody({ n }: { n: GraphNode }) {
  if (n.kind === "project") {
    return (
      <>
        <rect width={NODE_W} height={NODE_H} rx={6} fill="var(--ink)" />
        <text x={14} y={NODE_H / 2 + 4.5} fontSize={13} fontWeight={600} fill="var(--bg)" fontFamily="var(--font-space)">
          {trunc(n.label, 17)}
        </text>
        <circle cx={NODE_W - 14} cy={NODE_H / 2} r={3.5} fill="var(--ok)" />
      </>
    );
  }
  if (n.kind === "vuln") {
    const high = n.severity === "high";
    return (
      <>
        <rect width={NODE_W} height={NODE_H} rx={6} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={high ? 1.75 : 1.25} />
        <g transform={`translate(11, ${NODE_H / 2 - 7}) scale(0.58)`}>
          <path d="M12 2 L20 5 V11 C20 16.5 16.7 20.4 12 22 C7.3 20.4 4 16.5 4 11 V5 Z" fill="none" stroke="var(--accent-ink)" strokeWidth="2" />
          <path d="M12 8 v5 M12 15.5 v0.5" stroke="var(--accent-ink)" strokeWidth="2" strokeLinecap="round" />
        </g>
        <text x={32} y={NODE_H / 2 - 2} fontSize={11.5} fontWeight={600} fill="var(--accent-ink)" fontFamily="var(--font-mono)">
          {trunc(n.label, 15)}
        </text>
        <text x={32} y={NODE_H / 2 + 12} fontSize={9.5} fill="var(--accent-ink)" opacity={0.8} fontFamily="var(--font-mono)">
          {n.sub}
        </text>
      </>
    );
  }
  // Module group (collapsed packages)
  if (n.id.startsWith("module:")) {
    return (
      <>
        <rect width={NODE_W} height={NODE_H} rx={6} fill="var(--surface)" stroke="var(--link)" strokeWidth={1.5} />
        <rect x={4} y={-3} width={NODE_W - 8} height={NODE_H} rx={6} fill="var(--surface)" stroke="var(--line-strong)" opacity={0.6} />
        <rect width={NODE_W} height={NODE_H} rx={6} fill="var(--surface)" stroke="var(--link)" strokeWidth={1.5} />
        <text x={12} y={NODE_H / 2 - 2} fontSize={12} fontWeight={600} fill="var(--ink)" fontFamily="var(--font-space)">
          {trunc(n.label, 15)}
        </text>
        <text x={12} y={NODE_H / 2 + 12} fontSize={10} fill="var(--link)" fontFamily="var(--font-mono)">
          {n.sub} ▸ expand
        </text>
      </>
    );
  }
  if (n.id.startsWith("file-group:")) {
    return (
      <>
        <rect width={NODE_W} height={NODE_H} rx={6} fill="var(--surface)" stroke="var(--line-strong)" strokeDasharray="6 3" />
        <text x={28} y={NODE_H / 2 - 2} fontSize={11} fontWeight={500} fill="var(--ink)" fontFamily="var(--font-mono)">
          {trunc(n.label, 16)}
        </text>
        <text x={28} y={NODE_H / 2 + 12} fontSize={9} fill="var(--faint)" fontFamily="var(--font-mono)">
          {trunc(n.sub ?? "", 18)}
        </text>
        <g transform={`translate(10, ${NODE_H / 2 - 6})`}>
          <path d="M2 2 H7 L9 5 H12 V12 H2 Z" fill="var(--bg)" stroke="var(--faint)" strokeWidth={1.2} />
        </g>
      </>
    );
  }
  if (n.kind === "file") {
    return (
      <>
        <rect width={NODE_W} height={NODE_H} rx={6} fill="var(--surface)" stroke="var(--line-strong)" strokeDasharray="4 3" />
        <text x={12} y={NODE_H / 2 - 2} fontSize={11} fontWeight={500} fill="var(--ink)" fontFamily="var(--font-mono)">
          {trunc(n.label.replace(/^src\//, ""), 19)}
        </text>
        <text x={12} y={NODE_H / 2 + 12} fontSize={9} fill="var(--faint)" fontFamily="var(--font-mono)">
          imports {trunc(n.sub ?? "", 13)}
        </text>
      </>
    );
  }
  return (
    <>
      <rect width={NODE_W} height={NODE_H} rx={6} fill="var(--surface)" stroke="var(--line-strong)" />
      <text x={12} y={NODE_H / 2 - 2} fontSize={12.5} fontWeight={600} fill="var(--ink)" fontFamily="var(--font-space)">
        {trunc(n.label, 17)}
      </text>
      <text x={12} y={NODE_H / 2 + 12} fontSize={10} fill="var(--muted)" fontFamily="var(--font-mono)">
        v{n.sub}
      </text>
      {n.isDirect && <circle cx={NODE_W - 12} cy={12} r={3} fill="var(--link)" />}
    </>
  );
}

function CanvasButton({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="min-w-8 border border-line-strong bg-surface px-2 py-1 font-mono text-xs text-muted hover:text-ink"
    >
      {children}
    </button>
  );
}
