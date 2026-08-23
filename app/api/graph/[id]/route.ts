import { getGraph } from "@/lib/cognodb/queries";
import { getWorkerConfig, workerHeaders } from "@/lib/worker-client";
import { getAnalysis } from "@/lib/analysis-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // If WORKER_URL set, proxy to worker's graph endpoint (worker is source of truth for DB)
  const workerCfg = getWorkerConfig();
  if (workerCfg) {
    try {
      const target = `${workerCfg.url}/graph/${encodeURIComponent(id)}`;
      const res = await fetch(target, {
        headers: workerHeaders(workerCfg.token),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      return Response.json(data, { status: res.status });
    } catch {
      return Response.json(
        { error: "The dependency graph is temporarily unavailable. Please try again." },
        { status: 502 }
      );
    }
  }

  // Local in-process: read directly from CognoDB
  // Verify analysis exists in store first (for 404 semantics)
  const rec = getAnalysis(id);
  if (!rec && !id.includes("--")) {
    // still try DB even if store miss (VPS restart may have DB but not memory)
  }

  try {
    const graph = await getGraph(id);
    if (!graph) {
      return Response.json({ error: "We couldn't find this analysis graph." }, { status: 404 });
    }
    // patch repositoryUrl/name from store if available
    if (rec) {
      graph.repositoryUrl = rec.repositoryUrl;
      graph.name = rec.repoPath.split("/")[1] ?? graph.name;
    }
    return Response.json(graph);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The dependency graph is temporarily unavailable.";
    if (msg.includes("temporarily unavailable")) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json({ error: "The dependency graph is temporarily unavailable. Please try again." }, { status: 503 });
  }
}
