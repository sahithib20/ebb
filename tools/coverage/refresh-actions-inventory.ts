// Maintainer-only network tool. Tests never call it.
//
//   npm run build --silent
//   node dist/tools/coverage/refresh-actions-inventory.js
//
// Rewrites tools/coverage/expected/github-actions-inventory.json from the reviewed scope.
// It does not edit registry/. The scope file stays hand-edited.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parse as parseYaml } from "yaml";

import {
  actionRepo,
  parseActionsInventory,
  parseActionsScope,
  type InventoryAction,
  type InventoryMajor,
  type InventoryRelease,
} from "./actions.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const RETIRED = new Set(["node12", "node16", "node20"]);
const EXACT = /^v(\d+)\.(\d+)\.(\d+)$/;
const MAJOR_TAG = /^v(\d+)$/;

interface GitHubTag {
  name: string;
}

function headers(): HeadersInit {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "ebb-actions-inventory",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function compareVersion(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/** Releases in a major whose `runs.using` is not uniform. A single using is already covered by the major probe. */
export function releasesToRecord(observed: readonly InventoryRelease[]): InventoryRelease[] {
  const groups = new Map<number, InventoryRelease[]>();
  for (const release of observed) {
    const major = Number(release.version.split(".")[0]);
    const list = groups.get(major) ?? [];
    list.push(release);
    groups.set(major, list);
  }
  const recorded: InventoryRelease[] = [];
  for (const list of groups.values()) {
    if (new Set(list.map((release) => release.using)).size < 2) continue;
    recorded.push(...list);
  }
  recorded.sort((left, right) => compareVersion(left.version, right.version));
  return recorded;
}

async function tags(repo: string): Promise<GitHubTag[]> {
  const results: GitHubTag[] = [];
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${repo}/tags?per_page=100&page=${page}`;
    const response = await fetch(url, { headers: headers() });
    if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
    const batch = (await response.json()) as GitHubTag[];
    results.push(...batch);
    if (batch.length < 100) return results;
  }
}

async function usingAt(
  repo: string,
  ref: string,
  files: readonly string[],
): Promise<{ using: string | null; file: string } | undefined> {
  for (const file of files) {
    const url = `https://raw.githubusercontent.com/${repo}/${ref}/${file}`;
    const response = await fetch(url, { headers: { "User-Agent": "ebb-actions-inventory" } });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
    let using: unknown;
    try {
      using = (parseYaml(await response.text()) as { runs?: { using?: unknown } } | null)?.runs?.using;
    } catch {
      using = undefined;
    }
    return { using: typeof using === "string" ? using : null, file };
  }
  return undefined;
}

async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function refreshAction(action: string, notes: string | undefined): Promise<InventoryAction> {
  const repo = actionRepo(action);
  const subpath = action.split("/")[2];
  const files = subpath ? [`${subpath}/action.yml`, `${subpath}/action.yaml`] : ["action.yml", "action.yaml"];
  const names = await tags(repo);
  const majorTags = names
    .map((tag) => MAJOR_TAG.exec(tag.name)?.[1])
    .filter((major): major is string => major !== undefined);
  const exact = names
    .map((tag) => tag.name)
    .filter((name) => EXACT.test(name))
    .sort((left, right) => compareVersion(left.slice(1), right.slice(1)));

  const majorResults = await mapPool(majorTags, 6, async (major) => {
    const found = await usingAt(repo, `v${major}`, files);
    return found ? { major: Number(major), using: found.using, file: found.file } : undefined;
  });
  const majors = majorResults
    .filter((entry): entry is InventoryMajor => entry !== undefined)
    .sort((a, b) => a.major - b.major);

  const exactResults = await mapPool(exact, 6, async (tag) => {
    const found = await usingAt(repo, tag, files);
    return found ? { version: tag.slice(1), using: found.using, file: found.file } : undefined;
  });
  const observed = exactResults.filter((entry): entry is InventoryRelease => entry !== undefined);
  const releases = releasesToRecord(observed);
  const retiredMajors = majors.filter((entry) => entry.using !== null && RETIRED.has(entry.using));

  return {
    majors,
    ...(releases.length > 0 ? { releases } : {}),
    retiredMajors,
    ...(notes ? { notes } : {}),
  };
}

export async function refreshActionsInventory(root = ROOT): Promise<boolean> {
  const expected = join(root, "tools/coverage/expected");
  const scope = parseActionsScope(JSON.parse(await readFile(join(expected, "github-actions.json"), "utf8")));
  const inventory = parseActionsInventory(
    JSON.parse(await readFile(join(expected, "github-actions-inventory.json"), "utf8")),
  );
  const actions: Record<string, InventoryAction> = {};
  for (const action of scope.actions) {
    const previous = inventory.actions[action.action];
    actions[action.action] = await refreshAction(action.action, previous?.notes);
    process.stdout.write(`refreshed ${action.action}\n`);
  }
  if (isDeepStrictEqual(inventory.actions, actions)) {
    process.stdout.write("inventory unchanged\n");
    return false;
  }
  const next = {
    schemaVersion: inventory.schemaVersion,
    reviewedAt: today(),
    retiredRuntimes: inventory.retiredRuntimes,
    actions,
    ...(inventory.templates ? { templates: inventory.templates } : {}),
  };
  await writeFile(join(expected, "github-actions-inventory.json"), `${JSON.stringify(next, null, 2)}\n`);
  return true;
}

const isDirect = process.argv[1] !== undefined && /refresh-actions-inventory\.(ts|js)$/.test(process.argv[1]);
if (isDirect) {
  refreshActionsInventory().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
