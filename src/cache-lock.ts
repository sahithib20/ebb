import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EbbError } from "./errors.js";

export const DEFAULT_LOCK_TIMEOUT_MS = 5000;
export const TEN_MINUTES_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 50;

export class CacheLockError extends EbbError {
  readonly suggestedStep?: string | undefined;

  constructor(message: string, suggestedStep?: string | undefined) {
    const fullMessage = suggestedStep ? `${message} Suggested next step: ${suggestedStep}` : message;
    super("data-update-failed", fullMessage);
    this.name = "CacheLockError";
    this.suggestedStep = suggestedStep;
  }
}

export interface CacheLockOptions {
  timeoutMs?: number | undefined;
  staleMs?: number | undefined;
  pollIntervalMs?: number | undefined;
}

export function cacheLockPath(cacheDirectory: string): string {
  return join(cacheDirectory, "data", ".lock");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquires a cooperative lock on the cache directory.
 * Waits up to timeoutMs before failing.
 * Removes locks older than staleMs (default 10 minutes).
 */
export async function acquireCacheLock(
  cacheDirectory: string,
  options: CacheLockOptions = {},
): Promise<() => Promise<void>> {
  const lockPath = cacheLockPath(cacheDirectory);
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = options.staleMs ?? TEN_MINUTES_MS;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;

  await mkdir(dirname(lockPath), { recursive: true });

  const start = Date.now();

  while (true) {
    try {
      const payload = JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        timeMs: Date.now(),
      });
      await writeFile(lockPath, payload, { flag: "wx" });

      // Acquired lock successfully
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await rm(lockPath, { force: true });
        } catch {
          // ignore error removing lock on release
        }
      };
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error?.code !== "EEXIST") {
        throw error;
      }

      // File exists - check if it is stale (> 10 minutes)
      let isStale = false;
      try {
        const fileStat = await stat(lockPath);
        const ageMs = Date.now() - fileStat.mtimeMs;
        if (ageMs > staleMs) {
          isStale = true;
        } else {
          // Double check JSON content
          try {
            const raw = await readFile(lockPath, "utf8");
            const parsed = JSON.parse(raw) as { timeMs?: number; createdAt?: string };
            const time = parsed.timeMs ?? (parsed.createdAt ? Date.parse(parsed.createdAt) : NaN);
            if (!Number.isNaN(time) && Date.now() - time > staleMs) {
              isStale = true;
            }
          } catch {
            // Unparseable lock file older than mtime check
          }
        }
      } catch {
        // If file disappeared between open and stat, loop again immediately
        continue;
      }

      if (isStale) {
        try {
          await rm(lockPath, { force: true });
          continue;
        } catch {
          // Concurrent process may have removed it
        }
      }

      const elapsed = Date.now() - start;
      if (elapsed >= timeoutMs) {
        throw new CacheLockError(
          `Could not acquire cache lock for "${cacheDirectory}": update in progress.`,
          `Another update is running or an active lock exists at "${lockPath}".`,
        );
      }

      await sleep(Math.min(pollIntervalMs, timeoutMs - elapsed));
    }
  }
}

/**
 * Runs an action while holding the cache lock.
 */
export async function withCacheLock<T>(
  cacheDirectory: string,
  action: () => Promise<T>,
  options: CacheLockOptions = {},
): Promise<T> {
  const release = await acquireCacheLock(cacheDirectory, options);
  try {
    return await action();
  } finally {
    await release();
  }
}
