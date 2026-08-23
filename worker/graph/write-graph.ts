import type { FileImport, PackageRecord, VulnerabilityFinding } from "../types";

/**
 * Step 5 placeholder.
 * Will be replaced by CognoDB graph builder (Project/Package/Vulnerability/File nodes).
 *
 * Keep signature stable so worker/index.ts does not churn when Step 5 lands.
 */
export type WriteGraphInput = {
  analysisId: string;
  projectName: string;
  packages: PackageRecord[];
  vulnerabilities: VulnerabilityFinding[];
  fileImports: FileImport[];
};

export async function writeGraph(input: WriteGraphInput): Promise<void> {
  // TODO Step 5: create (:Project)-[:DEPENDS_ON]->(:Package)-[:HAS_VULNERABILITY]->(:Vulnerability)
  // and (:File)-[:IMPORTS]->(:Package) via parameterized Cypher through CognoDB driver.
  // For now no-op so Step 4 can complete end-to-end.
  void input;
  return;
}
