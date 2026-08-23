import { getDemoAnalysis } from "@/lib/demo-data";
import { slugToRepoPath, toGithubUrl } from "@/lib/github";
import Explorer from "@/components/explorer/explorer";

export default async function AnalysisPage({
  params,
}: PageProps<"/analysis/[id]">) {
  const { id } = await params;
  const repoPath = slugToRepoPath(id);
  const analysis = getDemoAnalysis(
    id,
    repoPath ? toGithubUrl(repoPath) : undefined
  );
  return <Explorer analysis={analysis} />;
}
