export type AnalysisStatus =
  | "queued"
  | "cloning"
  | "parsing"
  | "scanning"
  | "building_graph"
  | "complete"
  | "failed";

export type AnalysisStats = {
  packages: number;
  direct: number;
  transitive: number;
  vulnerable: number;
  affectedPaths: number;
};

export type AnalysisRecord = {
  id: string;
  repoPath: string;
  repositoryUrl: string;
  status: AnalysisStatus;
  error?: string;
  createdAt: number;
  completedAt?: number;
  stats?: AnalysisStats;
};

type Store = Map<string, AnalysisRecord>;

const globalStore = globalThis as unknown as { __depgraphStore?: Store };
const store: Store = globalStore.__depgraphStore ?? new Map();
globalStore.__depgraphStore = store;

export function createAnalysis(input: {
  id: string;
  repoPath: string;
  repositoryUrl: string;
}): AnalysisRecord {
  const record: AnalysisRecord = {
    ...input,
    status: "queued",
    createdAt: Date.now(),
  };
  store.set(input.id, record);
  return record;
}

export function getAnalysis(id: string): AnalysisRecord | undefined {
  return store.get(id);
}

export function updateAnalysis(
  id: string,
  patch: Partial<Omit<AnalysisRecord, "id">>
): AnalysisRecord | undefined {
  const current = store.get(id);
  if (!current) return undefined;
  const next = { ...current, ...patch };
  store.set(id, next);
  return next;
}

export function deleteAnalysis(id: string): boolean {
  return store.delete(id);
}
