export type Severity = "high" | "moderate";

export type GraphKind = "project" | "package" | "vuln" | "file";

export type GraphNode = {
  id: string;
  kind: GraphKind;
  label: string;
  sub?: string;
  depth: number;
  severity?: Severity;
  isDirect?: boolean;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: "DEPENDS_ON" | "IMPORTS";
};

export type Vulnerability = {
  key: string;
  packageName: string;
  version: string;
  severity: Severity;
  identifier: string;
  affectedRange: string;
  summary?: string;
  fixVersion?: string;
  cves?: string[];
  dependencyPaths?: string[][];
  primaryParent?: string;
  recommendedAction?: string;
  runnableFixCommand?: string;
  relationship?: string;
  blastRadius: {
    dependentPackages: number;
    dependencyPaths: number;
    directPaths: number;
    transitivePaths: number;
    pathNodeIds: string[][];
  };
};

export type FileImport = {
  file: string;
  pkgId: string;
  pkgName: string;
  line: number;
};

export type Analysis = {
  id: string;
  repositoryUrl: string;
  name: string;
  stats: {
    packages: number;
    direct: number;
    transitive: number;
    vulnerable: number;
    affectedPaths: number;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
  vulnerabilities: Vulnerability[];
  fileImports: FileImport[];
};

export function dependentsOf(analysis: Analysis, nodeId: string): string[] {
  const visited = new Set<string>([nodeId]);
  const result = new Set<string>();
  const queue: string[] = [nodeId];
  const incomingMap = new Map<string, string[]>();
  for (const e of analysis.edges) {
    const arr = incomingMap.get(e.target) ?? [];
    arr.push(e.source);
    incomingMap.set(e.target, arr);
  }
  while (queue.length) {
    const cur = queue.shift()!;
    const parents = incomingMap.get(cur) ?? [];
    for (const p of parents) {
      if (!visited.has(p)) {
        visited.add(p);
        result.add(p);
        queue.push(p);
      }
    }
  }
  return [...result];
}

export function dependenciesOf(analysis: Analysis, nodeId: string): string[] {
  return analysis.edges
    .filter((e) => e.source === nodeId && e.kind === "DEPENDS_ON")
    .map((e) => e.target);
}

export function filesImporting(analysis: Analysis, nodeIds: string[]): FileImport[] {
  const set = new Set(nodeIds);
  return analysis.fileImports.filter((f) => set.has(f.pkgId));
}
