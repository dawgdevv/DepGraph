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

export function getDemoAnalysis(id: string, repositoryUrl?: string): Analysis {
  const nodes: GraphNode[] = [
    { id: "proj", kind: "project", label: "my-next-app", depth: 0 },
    { id: "api-client", kind: "package", label: "api-client", sub: "2.1.0", depth: 1, isDirect: true },
    { id: "package-a", kind: "package", label: "package-a", sub: "4.0.2", depth: 1, isDirect: true },
    { id: "express", kind: "package", label: "express", sub: "4.21.0", depth: 1, isDirect: true },
    { id: "axios", kind: "package", label: "axios", sub: "1.8.4", depth: 2 },
    { id: "form-data", kind: "package", label: "form-data", sub: "4.0.0", depth: 2 },
    { id: "package-b", kind: "package", label: "package-b", sub: "0.3.1", depth: 2 },
    { id: "body-parser", kind: "package", label: "body-parser", sub: "1.20.3", depth: 2 },
    { id: "follow-redirects", kind: "package", label: "follow-redirects", sub: "1.15.9", depth: 3 },
    { id: "minimist", kind: "package", label: "minimist", sub: "1.2.8", depth: 3 },
    { id: "vuln-follow-redirects", kind: "vuln", label: "CVE-2025-0999", sub: "HIGH", depth: 4, severity: "high" },
    { id: "vuln-minimist", kind: "vuln", label: "CVE-2021-44906", sub: "MODERATE", depth: 4, severity: "moderate" },
  ];

  const edges: GraphEdge[] = [
    { id: "e1", source: "proj", target: "api-client", kind: "DEPENDS_ON" },
    { id: "e2", source: "proj", target: "package-a", kind: "DEPENDS_ON" },
    { id: "e3", source: "proj", target: "express", kind: "DEPENDS_ON" },
    { id: "e4", source: "api-client", target: "axios", kind: "DEPENDS_ON" },
    { id: "e5", source: "api-client", target: "form-data", kind: "DEPENDS_ON" },
    { id: "e6", source: "package-a", target: "package-b", kind: "DEPENDS_ON" },
    { id: "e7", source: "express", target: "body-parser", kind: "DEPENDS_ON" },
    { id: "e8", source: "axios", target: "follow-redirects", kind: "DEPENDS_ON" },
    { id: "e9", source: "package-b", target: "minimist", kind: "DEPENDS_ON" },
    { id: "e10", source: "follow-redirects", target: "vuln-follow-redirects", kind: "DEPENDS_ON" },
    { id: "e11", source: "minimist", target: "vuln-minimist", kind: "DEPENDS_ON" },
  ];

  const vulnerabilities: Vulnerability[] = [
    {
      key: "vuln-follow-redirects",
      packageName: "follow-redirects",
      version: "1.15.9",
      severity: "high",
      identifier: "CVE-2025-0999",
      affectedRange: "<1.15.6",
      blastRadius: {
        dependentPackages: 3,
        dependencyPaths: 2,
        directPaths: 1,
        transitivePaths: 1,
        pathNodeIds: [
          ["proj", "api-client", "axios", "follow-redirects"],
        ],
      },
    },
    {
      key: "vuln-minimist",
      packageName: "minimist",
      version: "1.2.8",
      severity: "moderate",
      identifier: "CVE-2021-44906",
      affectedRange: "<1.2.6",
      blastRadius: {
        dependentPackages: 3,
        dependencyPaths: 1,
        directPaths: 0,
        transitivePaths: 1,
        pathNodeIds: [
          ["proj", "package-a", "package-b", "minimist"],
        ],
      },
    },
  ];

  const fileImports: FileImport[] = [
    { file: "src/lib/api-client.ts", pkgId: "axios", pkgName: "axios", line: 3 },
    { file: "src/app/fetch-users.ts", pkgId: "api-client", pkgName: "api-client", line: 1 },
    { file: "src/scripts/parse-args.ts", pkgId: "minimist", pkgName: "minimist", line: 2 },
    { file: "src/lib/redirect-probe.ts", pkgId: "follow-redirects", pkgName: "follow-redirects", line: 1 },
  ];

  return {
    id,
    repositoryUrl:
      repositoryUrl ?? "https://github.com/demo-labs/my-next-app",
    name: "my-next-app",
    stats: {
      packages: 187,
      direct: 31,
      transitive: 156,
      vulnerable: vulnerabilities.length,
      affectedPaths: 3,
    },
    nodes,
    edges,
    vulnerabilities,
    fileImports,
  };
}

export function dependentsOf(analysis: Analysis, nodeId: string): string[] {
  const incoming = analysis.edges.filter((e) => e.target === nodeId);
  const parents = incoming.map((e) => e.source);
  const all = new Set<string>();
  for (const p of parents) {
    all.add(p);
    for (const gp of dependentsOf(analysis, p)) all.add(gp);
  }
  return [...all];
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
