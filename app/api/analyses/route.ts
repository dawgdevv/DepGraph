import { createAnalysis } from "@/lib/analysis-store";
import { parseGithubInput, toGithubUrl } from "@/lib/github";

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be JSON." },
      { status: 400 }
    );
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
      analysisUrl: `/analysis/${parsed.owner}--${parsed.repo}`,
      status: "queued",
    },
    { status: 201 }
  );
}
