import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASE_LOG_SCHEMA, type ReleaseLogEntry, verifyReleaseLog } from "../data-release-log.js";
import { defaultCacheDirectory } from "../data-source.js";

export interface ReleaseLogCliOptions {
  format?: string | undefined;
  cacheDirectory?: string | undefined;
  logPath?: string | undefined;
}

export interface ReleaseLogIo {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

export function runReleaseLog(options: ReleaseLogCliOptions, io: ReleaseLogIo): number {
  const cache = options.cacheDirectory ?? defaultCacheDirectory();
  const logPath = options.logPath ?? join(cache, "data", "release-log.jsonl");

  if (!existsSync(logPath)) {
    if (options.format === "json") {
      io.stdout.write(`${JSON.stringify({ schemaVersion: RELEASE_LOG_SCHEMA, releases: [] }, null, 2)}\n`);
    } else {
      io.stdout.write("No local data release log found.\n");
    }
    return 0;
  }

  let text: string;
  try {
    text = readFileSync(logPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.stderr.write(`Error: Failed to read release log: ${msg}\n`);
    return 1;
  }

  if (!text.trim()) {
    if (options.format === "json") {
      io.stdout.write(`${JSON.stringify({ schemaVersion: RELEASE_LOG_SCHEMA, releases: [] }, null, 2)}\n`);
    } else {
      io.stdout.write("No local data release log found.\n");
    }
    return 0;
  }

  let entries: ReleaseLogEntry[];
  try {
    entries = verifyReleaseLog(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.stderr.write(`Error: Invalid release log: ${msg}\n`);
    return 1;
  }

  if (options.format === "json") {
    io.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: RELEASE_LOG_SCHEMA,
          count: entries.length,
          releases: entries,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  if (options.format === "markdown") {
    const lines: string[] = ["### Data Release Log\n", "| Version | Date | Digest |", "| :--- | :--- | :--- |"];
    for (const e of entries) {
      lines.push(`| ${e.version} | ${e.createdAt.slice(0, 10)} | \`${e.contentDigest}\` |`);
    }
    io.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  const lines: string[] = ["Data releases in local log:"];
  for (const e of entries) {
    lines.push(`  ${e.version}  ${e.createdAt.slice(0, 10)}  ${e.contentDigest}`);
  }
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
