/**
 * Worker client for Next.js → VPS delegation.
 * When WORKER_URL is set (Vercel prod), Next proxies analyses to the Bun worker service.
 * Otherwise falls back to in-process worker.
 */

export function getWorkerConfig(): { url: string; token: string } | null {
  const raw = process.env.WORKER_URL ?? process.env.NEXT_PUBLIC_WORKER_URL ?? "";
  const url = raw.trim().replace(/\/$/, "");
  if (!url) return null;
  const token = (process.env.WORKER_TOKEN ?? process.env.WORKER_SECRET ?? "").trim();
  return { url, token };
}

export function workerHeaders(token: string): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export async function proxyToWorker(
  path: string, // e.g. "/analyses" or "/analyses/abc"
  init: RequestInit
): Promise<Response> {
  const cfg = getWorkerConfig();
  if (!cfg) throw new Error("WORKER_URL not configured");
  const target = `${cfg.url}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  if (cfg.token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${cfg.token}`);
  }
  // ensure JSON
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");

  const res = await fetch(target, {
    ...init,
    headers,
    // worker may be slow on cold start; allow 10s for proxy
    signal: init.signal,
  });
  return res;
}
