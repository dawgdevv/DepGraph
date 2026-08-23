import { spawn } from "node:child_process";

const CLONE_TIMEOUT_MS = 60_000;

export class CloneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloneError";
  }
}

/**
 * Clone public GitHub repo with `git clone --depth 1`.
 * shell:false, timeout 60s per spec.
 */
export async function cloneRepository(
  url: string,
  destDir: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["clone", "--depth", "1", url, destDir], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // hard kill after grace
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 2_000);
    }, CLONE_TIMEOUT_MS);

    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new CloneError(`We couldn't read this repository. ${err.message}`)
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new CloneError(
            "We couldn't read this repository. Clone timed out after 60 seconds."
          )
        );
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      const msg = stderr.trim() || `git clone exited with code ${code}`;
      // sanitize: don't leak full stderr if it contains secrets
      reject(new CloneError(`We couldn't read this repository. ${msg}`));
    });
  });
}
