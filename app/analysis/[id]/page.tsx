import AnalysisPoller from "@/components/analysis-poller";

export default async function AnalysisPage({
  params,
}: PageProps<"/analysis/[id]">) {
  const { id } = await params;
  return <AnalysisPoller id={id} />;
}
