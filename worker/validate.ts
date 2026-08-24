import { stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

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

async function runNpm(repoDir: string, args: string[], lockPath: string): Promise<{ ok: boolean; stderr: string }> {
  return await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
    const child = spawn("npm", args, {
      shell: false,
      cwd: repoDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 2000);
    }, 60_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, stderr });
    });
    child.on("close", async (code: number | null) => {
      clearTimeout(timer);
      if (code === 0 && (await exists(lockPath))) {
        resolve({ ok: true, stderr });
      } else {
        resolve({ ok: false, stderr });
      }
    });
  });
}

async function tryGenerateLockfile(repoDir: string): Promise<boolean> {
  const lockPath = path.join(repoDir, "package-lock.json");
  if (await exists(lockPath)) return true;

  console.log(`[validate] package-lock.json missing — generating via npm install --package-lock-only ...`);
  let res = await runNpm(repoDir, ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], lockPath);
  if (res.ok) {
    console.log(`[validate] lockfile generated successfully`);
    return true;
  }
  if (res.stderr) console.warn(`[validate] npm lockfile generation failed: ${res.stderr.slice(0, 600)}`);

  // Retry with legacy peer deps for ERESOLVE workspaces like @deta/editor (svelte 5)
  if (res.stderr.includes("ERESOLVE") || res.stderr.includes("unable to resolve dependency tree")) {
    console.log(`[validate] retrying with --legacy-peer-deps ...`);
    res = await runNpm(repoDir, ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--legacy-peer-deps"], lockPath);
    if (res.ok) {
      console.log(`[validate] lockfile generated with --legacy-peer-deps`);
      return true;
    }
    if (res.stderr) console.warn(`[validate] retry failed: ${res.stderr.slice(0, 600)}`);
  }
  return false;
}

/**
 * Validate repository contains required npm files.
 * - package.json must exist (hard fail).
 * - package-lock.json: try to generate via npm if missing (build project file).
 *   If generation fails, allow fallback to package.json-only parsing (no throw) so
 *   analysis can still produce direct deps graph. parse-lockfile handles fallback.
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
    const generated = await tryGenerateLockfile(repoDir);
    if (generated) return;
    // Keep PRD copy as fallback but don't hard-fail if we can use package.json-only mode
    // Throw only if caller wants strict mode — we now allow parse-lockfile to fallback
    // So we log and return instead of throwing
    console.warn(
      `[validate] package-lock.json not found and generation failed — falling back to package.json-only parsing (direct deps only)`
    );
    // Do NOT throw; parseLockfile will build fallback graph
    return;
  }
}
