// Maintainer-only network tool. It is intentionally not wired into scans or npm run check.
//
//   npm run build --silent
//   node dist/tools/github-actions-shas.js --out registry/github-actions-shas.json

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { actionRepo, parseActionsScope } from "./coverage/actions.js";
import { chooseTag } from "./sha-tags.js";

const SCHEMA_VERSION = "ebb.github-actions-shas.v1";
const EXACT_VERSION = /^v\d+\.\d+\.\d+$/;
const SHA = /^[0-9a-f]{40}$/;

interface GitHubTag {
  name: string;
  commit: { sha: string };
}

interface GitHubActionsRegistry {
  rules: Array<{ "x-github-actions"?: { action?: string } }>;
}

interface ShaMapFile {
  actions?: Record<string, Record<string, string>>;
}

interface Arguments {
  out?: string;
}

function parseArguments(argv: string[]): Arguments {
  if (argv.length === 0) return {};
  if (argv.length === 2 && argv[0] === "--out" && argv[1]) return { out: argv[1] };
  throw new Error("Usage: github-actions-shas [--out <path>]");
}

function requestHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "ebb-sha-map-maintainer-tool",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function tags(action: string): Promise<GitHubTag[]> {
  const results: GitHubTag[] = [];
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${action}/tags?per_page=100&page=${page}`;
    const response = await fetch(url, { headers: requestHeaders() });
    if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
    const batch = (await response.json()) as GitHubTag[];
    results.push(...batch);
    if (batch.length < 100) return results;
  }
}

async function readShaMap(): Promise<Record<string, Record<string, string>>> {
  try {
    const parsed = JSON.parse(await readFile(resolve("registry/github-actions-shas.json"), "utf8")) as ShaMapFile;
    return parsed.actions ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/** Reviewed scope, registry hints, and keys already in the map. A subpath maps to `owner/repo`. */
async function coveredActions(existing: Record<string, Record<string, string>>): Promise<string[]> {
  const scope = parseActionsScope(
    JSON.parse(await readFile(resolve("tools/coverage/expected/github-actions.json"), "utf8")),
  );
  const registry = JSON.parse(await readFile(resolve("registry/github-actions.json"), "utf8")) as GitHubActionsRegistry;
  const names = new Set<string>(Object.keys(existing).map((action) => actionRepo(action)));
  for (const action of scope.actions) names.add(actionRepo(action.action));
  for (const rule of registry.rules) {
    const action = rule["x-github-actions"]?.action;
    if (action) names.add(actionRepo(action));
  }
  return [...names].sort();
}

async function buildShaRegistry(): Promise<{
  schemaVersion: typeof SCHEMA_VERSION;
  actions: Record<string, Record<string, string>>;
}> {
  const existing = await readShaMap();
  const actions: Record<string, Record<string, string>> = { ...existing };
  for (const action of await coveredActions(existing)) {
    const versions = new Map<string, string>();
    for (const tag of await tags(action)) {
      const sha = tag.commit.sha.toLowerCase();
      if (!EXACT_VERSION.test(tag.name) || !SHA.test(sha)) continue;
      const existing = versions.get(sha);
      versions.set(sha, existing && existing !== tag.name ? chooseTag(action, sha, existing, tag.name) : tag.name);
    }
    actions[action] = Object.fromEntries([...versions].sort(([left], [right]) => left.localeCompare(right)));
  }
  const sorted = Object.fromEntries(
    Object.keys(actions)
      .sort()
      .map((name) => [name, actions[name]!]),
  );
  return { schemaVersion: SCHEMA_VERSION, actions: sorted };
}

async function main(): Promise<void> {
  const { out } = parseArguments(process.argv.slice(2));
  const contents = `${JSON.stringify(await buildShaRegistry(), null, 2)}\n`;
  if (out) {
    await writeFile(resolve(out), contents);
    process.stdout.write(`Wrote ${out}\n`);
  } else {
    process.stdout.write(contents);
  }
}

await main();
