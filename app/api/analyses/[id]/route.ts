import { getAnalysis } from "@/lib/analysis-store";
import { getWorkerConfig, workerHeaders } from "@/lib/worker-client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const workerCfg = getWorkerConfig();
  if (workerCfg) {
    try {
      const target = `${workerCfg.url}/analyses/${encodeURIComponent(id)}`;
      const res = await fetch(target, {
        headers: workerHeaders(workerCfg.token),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      return Response.json(data, { status: res.status });
    } catch {
      return Response.json(
        { error: "The analysis service is temporarily unavailable. Please try again." },
        { status: 502 }
      );
    }
  }

  const record = getAnalysis(id);
  if (!record) {
    return Response.json({ error: "We couldn't find this analysis." }, { status: 404 });
  }
  return Response.json(record);
}
