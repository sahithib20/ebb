// Detects whether the registry data has changed since the last release in the release log.
//
//   node dist/tools/data-release-needed.js [logPath] [--root <root>]
//
// Prints "changed" or "unchanged" and exits 0 either way.
// Compares the bundle content digest, ignoring commit count or files outside the data bundle.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildDataBundle } from "../src/data-bundle.js";
import { verifyReleaseLog } from "../src/data-release-log.js";

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function isDataReleaseNeeded(
  options: { logPath?: string | undefined; logText?: string | undefined; root?: string | undefined } = {},
): Promise<"changed" | "unchanged"> {
  let logText = options.logText;
  if (logText === undefined && options.logPath) {
    try {
      logText = await readFile(resolve(options.logPath), "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        logText = "";
      } else {
        throw error;
      }
    }
  }

  // If there is no release log or it's empty, a release is needed
  if (!logText || logText.trim() === "") {
    return "changed";
  }

  const entries = verifyReleaseLog(logText);
  if (entries.length === 0) {
    return "changed";
  }

  const lastEntry = entries.at(-1)!;

  // Build the current bundle (content digest is deterministic from registry content)
  const currentBundle = await buildDataBundle({
    root: options.root ?? resolve("."),
    createdAt: "2026-01-01T00:00:00Z",
    minimumEbbVersion: "0.1.0",
  });

  if (currentBundle.manifest.contentDigest === lastEntry.contentDigest) {
    return "unchanged";
  }

  return "changed";
}

export async function main(argv: string[]): Promise<void> {
  const root = option(argv, "--root");
  let logPath = option(argv, "--log");
  if (!logPath) {
    for (const arg of argv) {
      if (!arg.startsWith("-")) {
        logPath = arg;
        break;
      }
    }
  }

  const result = await isDataReleaseNeeded({ logPath, root });
  process.stdout.write(`${result}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
