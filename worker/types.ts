/**
 * Shared worker types — PRD §7 contracts.
 */

export type PackageRecord = {
  /** Unique id: name@version or fallback to lock key */
  id: string;
  name: string;
  version: string;
  isDirect: boolean;
  /** Direct dependency names (bare specifiers) */
  dependencies: string[];
  /** Raw lock key, e.g. "node_modules/foo" */
  lockKey: string;
};

export type VulnerabilityFinding = {
  packageName: string;
  installedVersion: string;
  severity: string;
  identifier?: string;
  affectedRange?: string;
};

export type FileImport = {
  filePath: string;
  packageName: string;
  importType: "static" | "require" | "dynamic";
  line: number;
};

export type ParseLockfileResult = {
  packages: PackageRecord[];
  /** Total unique resolved packages (excluding root) */
  totalCount: number;
  directCount: number;
  transitiveCount: number;
};
