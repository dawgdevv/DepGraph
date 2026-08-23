import { getAnalysis } from "@/lib/analysis-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const record = getAnalysis(id);
  if (!record) {
    return Response.json({ error: "We couldn't find this analysis." }, { status: 404 });
  }
  return Response.json(record);
}
