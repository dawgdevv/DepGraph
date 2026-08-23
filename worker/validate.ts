import { stat } from "node:fs/promises";
import path from "node:path";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate repository contains required npm files.
 * Throws ValidationError with PRD-spec human-readable copy.
 */
export async function validateRepository(repoDir: string): Promise<void> {
  const pkgPath = path.join(repoDir, "package.json");
  const lockPath = path.join(repoDir, "package-lock.json");

  const hasPkg = await exists(pkgPath);
  if (!hasPkg) {
    throw new ValidationError(
      "package.json not found. This file is required to build the dependency graph."
    );
  }

  const hasLock = await exists(lockPath);
  if (!hasLock) {
    throw new ValidationError(
      "package-lock.json not found. The npm lockfile is required to build the resolved dependency graph."
    );
  }
}
