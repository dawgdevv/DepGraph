/** Canonical analysis store — shared by Next (in-process) and VPS worker service.
 *  Extracted from lib/analysis-store.ts so both runtimes import same logic without @/ alias.
 *  On VPS, optionally persisted to disk via WORKER_STORE_PATH.
 */
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

declare global {
  // eslint-disable-next-line no-var
  var __depgraphStore: Store | undefined;
}

function getGlobalStore(): Store {
  if (globalThis.__depgraphStore) return globalThis.__depgraphStore;
  const m = new Map<string, AnalysisRecord>();
  globalThis.__depgraphStore = m;
  return m;
}

const store: Store = getGlobalStore();

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

export function listAnalyses(): AnalysisRecord[] {
  return [...store.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** For testing / service persistence */
export function _getStore(): Store {
  return store;
}
export function _setStore(map: Map<string, AnalysisRecord>): void {
  globalThis.__depgraphStore = map;
}
