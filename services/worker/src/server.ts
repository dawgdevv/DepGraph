/**
 * DepGraph Worker Service — VPS deployable Bun server.
 * Acts as async worker for Next.js app deployed on Vercel.
 *
 * Vercel -> VPS flow:
 *   POST https://vps:PORT/analyses  { repositoryUrl }
 *   GET  https://vps:PORT/analyses/:id
 *   Vercel's /api/analyses proxies to this when WORKER_URL env is set.
 *
 * Run locally:  bun run src/server.ts
 * Env: PORT=3001 WORKER_TOKEN=secret COGNODB_URI=... WORKER_STORE_PATH=/data/analyses.json CORS_ORIGIN=https://your-vercel.app
 */

import { createAnalysis, getAnalysis, listAnalyses } from "../../../worker/store";
import { runAnalysis } from "../../../worker/index";
import { getGraph } from "../../../lib/cognodb/queries";

// --- env ---
const PORT = Number(process.env.PORT ?? process.env.WORKER_PORT ?? 3001);
const WORKER_TOKEN = process.env.WORKER_TOKEN ?? process.env.WORKER_SECRET ?? "";
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";
const STORE_PATH = process.env.WORKER_STORE_PATH ?? "";

// --- helpers ---
function shortId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function parseGithubInput(
  input: string
): { owner: string; repo: string } | null {
  // inline to avoid @/ alias in service (keeps service self-contained)
  const GITHUB_INPUT_RE =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)\/?(?:\.git)?(?:\/.*)?$/;
  const SLUG_RE = /^([\w.-]+)\/([\w.-]+)$/;
  const trimmed = input.trim();
  const m = trimmed.match(GITHUB_INPUT_RE);
  if (m) return { owner: m[1]!, repo: m[2]! };
  const s = trimmed.match(SLUG_RE);
  if (s && !trimmed.includes(".")) return { owner: s[1]!, repo: s[2]! };
  return null;
}
function toGithubUrl(repoPath: string) {
  return `https://github.com/${repoPath}`;
}

function corsHeaders(origin?: string): HeadersInit {
  const allowOrigin = CORS_ORIGIN === "*" ? origin ?? "*" : CORS_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data: unknown, init?: ResponseInit, req?: Request): Response {
  const headers = new Headers(init?.headers as HeadersInit);
  const origin = req?.headers.get("origin") ?? undefined;
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function unauthorized(req?: Request): Response {
  return json({ error: "Unauthorized" }, { status: 401 }, req);
}

function checkAuth(req: Request): boolean {
  if (!WORKER_TOKEN) return true;
  const hdr = req.headers.get("authorization") ?? "";
  // Support both Bearer and plain
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : hdr;
  if (token === WORKER_TOKEN) return true;
  // also allow ?token= query for simple polling
  const url = new URL(req.url);
  if (url.searchParams.get("token") === WORKER_TOKEN) return true;
  return false;
}

// --- optional disk persistence ---
async function loadStore() {
  if (!STORE_PATH) return;
  try {
    const file = Bun.file(STORE_PATH);
    if (!(await file.exists())) return;
    const raw = await file.json();
    if (!Array.isArray(raw)) return;
    const { _getStore } = await import("../../../worker/store");
    const map = _getStore();
    for (const rec of raw as unknown[]) {
      const r = rec as { id: string };
      if (r?.id) map.set(r.id, rec as never);
    }
    console.log(`[worker] restored ${map.size} analyses from ${STORE_PATH}`);
  } catch (e) {
    console.warn(`[worker] failed to load store ${STORE_PATH}:`, e);
  }
}
async function persistStore() {
  if (!STORE_PATH) return;
  try {
    const { mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(STORE_PATH), { recursive: true });
    const { _getStore } = await import("../../../worker/store");
    const arr = [..._getStore().values()];
    await Bun.write(STORE_PATH, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.warn("[worker] persist failed:", e);
  }
}
// debounce persist
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (!STORE_PATH) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void persistStore(), 500);
}

// --- server ---
const startedAt = Date.now();

await loadStore();

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(req.headers.get("origin") ?? undefined),
      });
    }

    // Health — no auth required (for load balancer / uptime checks)
    if (path === "/health" || path === "/api/health") {
      return json(
        {
          status: "ok",
          service: "depgraph-worker",
          uptime: Math.floor((Date.now() - startedAt) / 1000),
          analyses: listAnalyses().length,
          version: "0.1.0",
        },
        undefined,
        req
      );
    }

    // Auth guard for all /analyses + /graph routes
    if (
      path.startsWith("/analyses") ||
      path.startsWith("/api/analyses") ||
      path.startsWith("/graph") ||
      path.startsWith("/api/graph")
    ) {
      if (!checkAuth(req)) return unauthorized(req);
    }

    // Normalize path: support both /analyses and /api/analyses
    const normalized = path.replace(/^\/api/, "") || "/";

    // POST /analyses
    if (normalized === "/analyses" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "Request body must be JSON." }, { status: 400 }, req);
      }
      const raw =
        typeof body === "object" && body !== null
          ? ((body as Record<string, unknown>).repositoryUrl ??
            (body as Record<string, unknown>).url)
          : undefined;

      if (typeof raw !== "string") {
        return json(
          { error: "Please enter a valid public GitHub repository URL." },
          { status: 400 },
          req
        );
      }
      const parsed = parseGithubInput(raw);
      if (!parsed) {
        return json(
          { error: "Please enter a valid public GitHub repository URL." },
          { status: 400 },
          req
        );
      }
      const id = shortId();
      const repositoryUrl = toGithubUrl(`${parsed.owner}/${parsed.repo}`);
      createAnalysis({
        id,
        repoPath: `${parsed.owner}/${parsed.repo}`,
        repositoryUrl,
      });
      schedulePersist();

      // fire-and-forget
      void runAnalysis(id)
        .catch(() => {})
        .finally(() => schedulePersist());

      return json(
        {
          analysisId: id,
          repositoryUrl,
          statusUrl: `/api/analyses/${id}`,
          analysisUrl: `/analysis/${id}`,
          // also worker-native urls for Vercel proxy convenience
          id,
          status: "queued",
        },
        { status: 201 },
        req
      );
    }

    // GET /analyses  (list, optional)
    if (normalized === "/analyses" && req.method === "GET") {
      return json({ analyses: listAnalyses() }, undefined, req);
    }

    // GET /analyses/:id
    const m = normalized.match(/^\/analyses\/([^/]+)$/);
    if (m && req.method === "GET") {
      const id = m[1]!;
      const rec = getAnalysis(id);
      if (!rec) return json({ error: "We couldn't find this analysis." }, { status: 404 }, req);
      return json(rec, undefined, req);
    }

    // DELETE /analyses/:id
    if (m && req.method === "DELETE") {
      const id = m[1]!;
      const rec = getAnalysis(id);
      if (!rec) return json({ error: "We couldn't find this analysis." }, { status: 404 }, req);
      const { deleteAnalysis } = await import("../../../worker/store");
      deleteAnalysis(id);
      schedulePersist();
      return json({ deleted: true }, undefined, req);
    }

    // GET /graph/:id  — real CognoDB graph for Explorer
    const gm = normalized.match(/^\/graph\/([^/]+)$/);
    if (gm && req.method === "GET") {
      const gid = gm[1]!;
      const graph = await getGraph(gid);
      if (!graph) return json({ error: "We couldn't find this analysis graph." }, { status: 404 }, req);
      // patch repositoryUrl from store if available
      const rec = getAnalysis(gid);
      if (rec) {
        (graph as unknown as Record<string, unknown>).repositoryUrl = rec.repositoryUrl;
        (graph as unknown as Record<string, unknown>).name = rec.repoPath.split("/")[1] ?? (graph as unknown as { name: string }).name;
      }
      return json(graph, undefined, req);
    }

    return json({ error: "Not found" }, { status: 404 }, req);
  },
});

console.log(`[worker] listening on http://0.0.0.0:${server.port}`);
if (WORKER_TOKEN) console.log("[worker] auth enabled (WORKER_TOKEN set)");
else console.log("[worker] auth disabled — set WORKER_TOKEN to protect worker in production");
if (STORE_PATH) console.log(`[worker] persistence: ${STORE_PATH}`);
else console.log("[worker] persistence: in-memory only (set WORKER_STORE_PATH for disk persistence)");
console.log(`[worker] CORS_ORIGIN=${CORS_ORIGIN}`);

// graceful shutdown persist
process.on("SIGTERM", () => {
  console.log("[worker] SIGTERM, persisting...");
  void persistStore().finally(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("[worker] SIGINT, persisting...");
  void persistStore().finally(() => process.exit(0));
});
