import { createAnalysis } from "@/lib/analysis-store";
import { parseGithubInput, toGithubUrl } from "@/lib/github";
import { getWorkerConfig, workerHeaders } from "@/lib/worker-client";

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const raw =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).repositoryUrl ??
        (body as Record<string, unknown>).url
      : undefined;

  if (typeof raw !== "string") {
    return Response.json(
      { error: "Please enter a valid public GitHub repository URL." },
      { status: 400 }
    );
  }

  const parsed = parseGithubInput(raw);
  if (!parsed) {
    return Response.json(
      { error: "Please enter a valid public GitHub repository URL." },
      { status: 400 }
    );
  }

  // If WORKER_URL is set (Vercel → VPS), delegate to worker service.
  const workerCfg = getWorkerConfig();
  if (workerCfg) {
    try {
      const target = `${workerCfg.url}/analyses`;
      const res = await fetch(target, {
        method: "POST",
        headers: workerHeaders(workerCfg.token),
        body: JSON.stringify({ repositoryUrl: raw }),
        // 15s timeout via AbortSignal
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => ({}));
      // Pass through status + body; normalize fields for client
      return Response.json(data, { status: res.status });
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "TimeoutError"
          ? "The analysis service is temporarily unavailable. Please try again."
          : "The analysis service is temporarily unavailable. Please try again.";
      return Response.json({ error: msg }, { status: 502 });
    }
  }

  // Local fallback: in-process worker (dev / no WORKER_URL)
  const id = shortId();
  const repositoryUrl = toGithubUrl(`${parsed.owner}/${parsed.repo}`);

  createAnalysis({
    id,
    repoPath: `${parsed.owner}/${parsed.repo}`,
    repositoryUrl,
  });

  const { runAnalysis } = await import("@/worker");
  void runAnalysis(id).catch(() => {});

  return Response.json(
    {
      analysisId: id,
      repositoryUrl,
      statusUrl: `/api/analyses/${id}`,
      analysisUrl: `/analysis/${id}`,
      status: "queued",
    },
    { status: 201 }
  );
}
