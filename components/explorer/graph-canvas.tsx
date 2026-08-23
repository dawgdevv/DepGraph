"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "@/lib/demo-data";

const NODE_W = 150;
const NODE_H = 46;
const V_GAP = 38;
const COL_GAP = 96;

type LayoutPos = { x: number; y: number };

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
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [t, setT] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const fittedRef = useRef(false);

  const layout = useMemo(() => {
    const cols = new Map<number, GraphNode[]>();
    for (const n of nodes) {
      const arr = cols.get(n.depth) ?? [];
      arr.push(n);
      cols.set(n.depth, arr);
    }
    const pos = new Map<string, LayoutPos>();
    let minX = Infinity;
    let maxX = -Infinity;
    let maxColCount = 0;
    for (const [depth, colNodes] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
      colNodes.sort((a, b) => a.label.localeCompare(b.label));
      const colH = colNodes.length * NODE_H + (colNodes.length - 1) * V_GAP;
      maxColCount = Math.max(maxColCount, colNodes.length);
      const x = depth * (NODE_W + COL_GAP);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + NODE_W);
      colNodes.forEach((n, i) => {
        pos.set(n.id, { x, y: -colH / 2 + i * (NODE_H + V_GAP) });
      });
    }
    return { pos, minX, maxX, height: maxColCount * NODE_H + (maxColCount - 1) * V_GAP };
  }, [nodes]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({
        w: entry.contentRect.width,
        h: entry.contentRect.height,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (fittedRef.current || size.w === 0 || layout.pos.size === 0) return;
    fittedRef.current = true;
    setT(fitTransform(size.w, size.h));
  }, [size, layout]);

  function fitTransform(w: number, h: number): Transform {
    const bw = Math.max(layout.maxX - layout.minX, 1);
    const k = Math.min(1.05, Math.max(0.35, (w - 80) / bw));
    const cx = (layout.minX + layout.maxX) / 2;
    return { x: w / 2 - cx * k, y: h / 2, k };
  }

  useEffect(() => {
    if (!focusTarget || size.w === 0) return;
    const p = layout.pos.get(focusTarget.nodeId);
    if (!p) return;
    const cx = p.x + NODE_W / 2;
    const cy = p.y + NODE_H / 2;
    setT((prev) => ({ ...prev, x: size.w / 2 - cx * prev.k, y: size.h / 2 - cy * prev.k }));
  }, [focusTarget, layout, size]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      setT((prev) => {
        const k = clamp(prev.k * Math.exp(-e.deltaY * 0.0016), 0.35, 2.4);
        const rect = el!.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const wx = (mx - prev.x) / prev.k;
        const wy = (my - prev.y) / prev.k;
        return { x: mx - wx * k, y: my - wy * k, k };
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y };
    setDragging(false);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!dragging && Math.hypot(dx, dy) > 3) setDragging(true);
    if (dragging) setT((prev) => ({ ...prev, x: d.ox + dx, y: d.oy + dy }));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const wasDragging = dragging;
    dragRef.current = null;
    setDragging(false);
    if (!wasDragging && e.target === e.currentTarget) onSelect(null);
  }

  function zoomBy(factor: number) {
    setT((prev) => {
      const k = clamp(prev.k * factor, 0.35, 2.4);
      const wx = (size.w / 2 - prev.x) / prev.k;
      const wy = (size.h / 2 - prev.y) / prev.k;
      return { x: size.w / 2 - wx * k, y: size.h / 2 - wy * k, k };
    });
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
        <g
          style={{
            transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})`,
            transition: dragging ? "none" : "transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
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
            const faded = dim(id);
            return (
              <g
                key={id}
                transform={`translate(${p.x}, ${p.y})`}
                opacity={faded ? 0.28 : 1}
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
        <CanvasButton label="Zoom in" onClick={() => zoomBy(1.25)}>+</CanvasButton>
        <CanvasButton label="Zoom out" onClick={() => zoomBy(0.8)}>−</CanvasButton>
        <CanvasButton label="Reset view" onClick={() => setT(fitTransform(size.w, size.h))}>
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

      {!dragging && (
        <div className="pointer-events-none absolute top-4 right-4 font-mono text-[10px] text-faint">
          scroll to zoom · drag to pan · click to inspect
        </div>
      )}
    </div>
  );
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

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
