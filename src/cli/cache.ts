import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { defaultCacheDirectory } from "../data-source.js";

export interface CacheCliOptions {
  subcommand?: string | undefined;
  format?: string | undefined;
  cacheDirectory?: string | undefined;
}

export interface CacheIo {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

interface CacheFileEntry {
  path: string;
  size: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Checks whether a directory looks like an authentic Ebb cache directory
 * to prevent accidental deletion when EBB_DATA_DIR is misconfigured.
 */
export function looksLikeEbbCache(cacheDir: string, explicitEnv = Boolean(process.env.EBB_DATA_DIR)): boolean {
  if (!explicitEnv) return true;
  const resolved = resolve(cacheDir);
  const root = resolve("/");
  const home = homedir();
  const tmp = resolve(tmpdir());
  if (resolved === root || resolved === home || resolved === tmp) return false;

  if (resolved.toLowerCase().includes("ebb")) return true;

  const dataDir = join(resolved, "data");
  if (
    existsSync(join(dataDir, "active.json")) ||
    existsSync(join(dataDir, "previous.json")) ||
    existsSync(join(dataDir, "release-log.jsonl"))
  ) {
    return true;
  }

  // Check for any version directory in data/
  if (existsSync(dataDir)) {
    try {
      const entries = readdirSync(dataDir);
      if (entries.some((entry) => /^\d{4}\.\d{2}\.\d{2}/.test(entry))) {
        return true;
      }
    } catch {
      // unreadable
    }
  }

  return false;
}

function collectFiles(dir: string, baseDir: string = dir): CacheFileEntry[] {
  const result: CacheFileEntry[] = [];
  if (!existsSync(dir)) return result;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...collectFiles(fullPath, baseDir));
      } else if (entry.isFile()) {
        try {
          const s = statSync(fullPath);
          result.push({
            path: relative(baseDir, fullPath).replace(/\\/g, "/"),
            size: s.size,
          });
        } catch {
          // ignore inaccessible file
        }
      }
    }
  } catch {
    // ignore inaccessible dir
  }
  return result;
}

export function runCache(options: CacheCliOptions, io: CacheIo): number {
  const cache = options.cacheDirectory ?? defaultCacheDirectory();
  const subcommand = options.subcommand ?? "info";

  if (subcommand === "path") {
    // Print the directory path without creating it
    io.stdout.write(`${cache}\n`);
    return 0;
  }

  if (subcommand === "clear") {
    const isExplicit = Boolean(options.cacheDirectory || process.env.EBB_DATA_DIR);
    if (!looksLikeEbbCache(cache, isExplicit)) {
      io.stderr.write(`Error: Refusing to clear cache: "${cache}" does not look like an Ebb cache directory.\n`);
      return 2;
    }

    const dataDir = join(cache, "data");
    if (!existsSync(dataDir)) {
      io.stdout.write("Cache is empty: nothing to clear.\n");
      return 0;
    }

    const removedItems: string[] = [];
    try {
      const entries = readdirSync(dataDir, { withFileTypes: true });
      const versions = entries.filter((e) => e.isDirectory() && /^\d{4}\.\d{2}\.\d{2}/.test(e.name)).map((e) => e.name);
      if (versions.length > 0) {
        removedItems.push(`cached data for ${versions.join(", ")}`);
      }
      if (existsSync(join(dataDir, "previous.json"))) {
        try {
          const raw = readFileSync(join(dataDir, "previous.json"), "utf8");
          const parsed = JSON.parse(raw) as { version?: string };
          removedItems.push(`rollback copy (${parsed.version ?? "unknown"})`);
        } catch {
          removedItems.push("rollback copy");
        }
      }
      if (existsSync(join(dataDir, "active.json"))) {
        removedItems.push("active version marker");
      }
      if (existsSync(join(dataDir, "releases-etag.txt"))) {
        removedItems.push("cached etag");
      }
      if (existsSync(join(dataDir, "release-log.jsonl"))) {
        removedItems.push("release log");
      }

      rmSync(dataDir, { recursive: true, force: true });
    } catch (err) {
      io.stderr.write(`Error: Failed to clear cache directory "${cache}": ${(err as Error).message}\n`);
      return 1;
    }

    const description = removedItems.length > 0 ? removedItems.join(", ") : "all cached data";
    io.stdout.write(`Cleared cache in "${cache}": removed ${description}.\n`);
    return 0;
  }

  if (subcommand === "info") {
    const dataDir = join(cache, "data");
    const files = collectFiles(dataDir, cache);

    if (files.length === 0) {
      if (options.format === "json") {
        io.stdout.write(`${JSON.stringify({ cacheDirectory: cache, empty: true }, null, 2)}\n`);
      } else {
        io.stdout.write("Cache is empty.\n");
      }
      return 0;
    }

    // Inspect active version
    let activeVersion: string | null = null;
    try {
      const activeRaw = readFileSync(join(dataDir, "active.json"), "utf8");
      const parsed = JSON.parse(activeRaw) as { version?: string };
      if (typeof parsed.version === "string") activeVersion = parsed.version;
    } catch {
      // not available
    }

    // Inspect creation date from bundle manifest
    let createdAt: string | null = null;
    let fetchedAt: string | null = null;
    if (activeVersion) {
      const bundlePath = join(dataDir, activeVersion, "bundle.json");
      try {
        const bundleRaw = readFileSync(bundlePath, "utf8");
        const parsed = JSON.parse(bundleRaw) as { manifest?: { createdAt?: string } };
        createdAt = parsed.manifest?.createdAt ?? null;
      } catch {
        // not available
      }
      try {
        const bundleStat = statSync(bundlePath);
        fetchedAt = bundleStat.mtime.toISOString();
      } catch {
        // not available
      }
    }

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    if (options.format === "json") {
      io.stdout.write(
        `${JSON.stringify(
          {
            cacheDirectory: cache,
            empty: false,
            version: activeVersion,
            createdAt,
            fetchedAt,
            totalSize,
            files: files.map((f) => ({ path: f.path, size: f.size })),
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }

    const lines: string[] = [`Cache directory: ${cache}`, `Active version:  ${activeVersion ?? "none"}`];
    if (fetchedAt) lines.push(`Date fetched:    ${fetchedAt}`);
    if (createdAt) lines.push(`Date created:    ${createdAt}`);
    lines.push("Files:");
    for (const f of files) {
      lines.push(`  ${f.path} (${formatBytes(f.size)})`);
    }
    lines.push(`Total size:      ${formatBytes(totalSize)}`);

    io.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  io.stderr.write(`Unknown cache subcommand "${subcommand}". Use "path", "info", or "clear".\n`);
  return 2;
}
