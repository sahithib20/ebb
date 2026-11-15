/**
 * Offline checker: compare reviewed official-Action majors to registry end rules.
 *
 *   node dist/tools/coverage/actions.js
 *   node dist/tools/coverage/actions.js --write-docs
 *
 * Exit 0 when every in-scope action is complete.
 * Exit 1 when coverage gaps remain (docs may still be written).
 * Exit 2 on checker or write failures.
 * Never fetches the network. Majors and runs.using come from the reviewed inventory.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { purlIdentity } from "../../src/purl.js";
import { registryV2Issues, validateRegistryV2, type RegistryV2Rule } from "../../src/registry.js";
import { versContains } from "../../src/vers.js";

// Compiled to dist/tools/coverage/*.js — three levels up is the repository root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const COVERAGE_DOC = join(ROOT, "docs/coverage.md");
const TABLE_BEGIN = "<!-- actions-coverage:begin -->";
const TABLE_END = "<!-- actions-coverage:end -->";
const SCOPE_NAME = "github-actions.json";
const INVENTORY_NAME = "github-actions-inventory.json";

/** Runtimes GitHub has removed from Actions runners. node24 is still provided. */
const RETIRED_USINGS = new Set(["node12", "node16", "node20"]);

/** End events. A scheduled rule still counts as coverage; node20's date has already passed, so new rules do not use it. */
const END_EVENTS = new Set(["end-of-life", "end-of-support", "removed", "scheduled-end-of-life"]);

export const EXIT_GAPS = 1;
export const EXIT_ERROR = 2;

export interface ExpectedSource {
  title: string;
  url: string;
  accessedAt: string;
}

export interface ExpectedAction {
  action: string;
  repoUrl: string;
  kind?: string;
  /** When set, the action is documented as limited and retired-runtime rules are not required. */
  coverageLimit?: string;
  notes?: string;
}

export interface ActionsScope {
  schemaVersion: "ebb.actions-scope.v1";
  reviewedAt: string;
  sources: ExpectedSource[];
  actions: ExpectedAction[];
}

export interface InventoryMajor {
  major: number;
  /** Null when that major tag's action.yml sets no runs.using. */
  using: string | null;
  file: string;
}

export interface InventoryAction {
  majors: InventoryMajor[];
  retiredMajors?: InventoryMajor[];
  notes?: string;
}

export interface ActionsInventory {
  schemaVersion: string;
  reviewedAt: string;
  retiredRuntimes: string[];
  actions: Record<string, InventoryAction>;
  templates?: string[];
}

export interface ActionGap {
  action: string;
  major: number;
  using: string;
  detail: string;
}

export interface ActionCoverage {
  action: string;
  /** Filesystem-safe id, used when the weekly job writes one issue per action. */
  slug: string;
  complete: boolean;
  coverageLimit?: string;
  missingMajors: string[];
  gaps: ActionGap[];
}

export interface ActionsCoverageReport {
  actions: ActionCoverage[];
  complete: boolean;
}

const ACTION_NAME = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;

/** `actions/checkout` becomes `actions-checkout` so issue files stay in one directory. */
export function actionSlug(action: string): string {
  const slug = action.replaceAll("/", "-");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`Invalid action identifier: ${action}`);
  }
  return slug;
}

function isSymbolRule(rule: RegistryV2Rule): boolean {
  return rule.usage?.some((matcher) => matcher.kind === "symbol") ?? false;
}

function actionPurl(action: string): string {
  return `pkg:github/${action.toLowerCase()}`;
}

/** True when an end rule for this action contains version `N.0.0`. A catch-all `<K.0.0` covers major N when N < K. */
export function majorCovered(rules: readonly RegistryV2Rule[], action: string, major: number): boolean {
  const identity = purlIdentity(actionPurl(action));
  const version = `${major}.0.0`;
  return rules.some(
    (rule) =>
      !isSymbolRule(rule) &&
      purlIdentity(rule.purl) === identity &&
      END_EVENTS.has(rule.event) &&
      versContains(rule.vers, version),
  );
}

export function assessAction(
  expected: ExpectedAction,
  majors: readonly InventoryMajor[] | undefined,
  rules: readonly RegistryV2Rule[],
): ActionCoverage {
  const slug = actionSlug(expected.action);
  if (expected.coverageLimit !== undefined) {
    return {
      action: expected.action,
      slug,
      complete: true,
      coverageLimit: expected.coverageLimit,
      missingMajors: [],
      gaps: [],
    };
  }

  if (majors === undefined) {
    return {
      action: expected.action,
      slug,
      complete: false,
      missingMajors: [],
      gaps: [
        {
          action: expected.action,
          major: 0,
          using: "",
          detail: `${expected.action} is in scope and has no coverage limit, but it is missing from the reviewed inventory`,
        },
      ],
    };
  }

  const gaps: ActionGap[] = [];
  const missingMajors: string[] = [];
  for (const entry of majors) {
    if (entry.using === null || !RETIRED_USINGS.has(entry.using)) continue;
    if (majorCovered(rules, expected.action, entry.major)) continue;
    missingMajors.push(`${entry.major} (${entry.using})`);
    gaps.push({
      action: expected.action,
      major: entry.major,
      using: entry.using,
      detail: `no end rule for ${actionPurl(expected.action)} contains ${entry.major}.0.0 (${entry.using})`,
    });
  }

  return {
    action: expected.action,
    slug,
    complete: gaps.length === 0,
    missingMajors,
    gaps,
  };
}

function isSource(value: unknown): value is ExpectedSource {
  if (typeof value !== "object" || value === null) return false;
  const source = value as Record<string, unknown>;
  return typeof source.title === "string" && typeof source.url === "string" && typeof source.accessedAt === "string";
}

function isExpectedAction(value: unknown): value is ExpectedAction {
  if (typeof value !== "object" || value === null) return false;
  const action = value as Record<string, unknown>;
  return typeof action.action === "string" && typeof action.repoUrl === "string";
}

export function parseActionsScope(value: unknown, label = SCOPE_NAME): ActionsScope {
  if (typeof value !== "object" || value === null) throw new Error(`${label} must be an object`);
  const scope = value as Record<string, unknown>;
  if (scope.schemaVersion !== "ebb.actions-scope.v1") {
    throw new Error(`${label} schemaVersion must be ebb.actions-scope.v1`);
  }
  if (typeof scope.reviewedAt !== "string" || !Array.isArray(scope.sources) || !scope.sources.every(isSource)) {
    throw new Error(`${label} needs reviewedAt and sources`);
  }
  if (!Array.isArray(scope.actions) || !scope.actions.every(isExpectedAction)) {
    throw new Error(`${label} needs an actions array of { action, repoUrl }`);
  }
  const seen = new Set<string>();
  for (const action of scope.actions) {
    if (!ACTION_NAME.test(action.action)) throw new Error(`${label} has an invalid action name: ${action.action}`);
    if (seen.has(action.action)) throw new Error(`${label} lists ${action.action} twice`);
    seen.add(action.action);
    const repoUrl = `https://github.com/${action.action}`;
    if (action.repoUrl !== repoUrl) throw new Error(`${action.action} repoUrl must be ${repoUrl}`);
  }
  return scope as unknown as ActionsScope;
}

function isInventoryMajor(value: unknown): value is InventoryMajor {
  if (typeof value !== "object" || value === null) return false;
  const major = value as Record<string, unknown>;
  return (
    typeof major.major === "number" &&
    (typeof major.using === "string" || major.using === null) &&
    typeof major.file === "string"
  );
}

export function parseActionsInventory(value: unknown, label = INVENTORY_NAME): ActionsInventory {
  if (typeof value !== "object" || value === null) throw new Error(`${label} must be an object`);
  const inventory = value as Record<string, unknown>;
  if (inventory.schemaVersion !== "ebb.actions-inventory.v1") {
    throw new Error(`${label} schemaVersion must be ebb.actions-inventory.v1`);
  }
  if (typeof inventory.reviewedAt !== "string" || !Array.isArray(inventory.retiredRuntimes)) {
    throw new Error(`${label} needs reviewedAt and retiredRuntimes`);
  }
  if (typeof inventory.actions !== "object" || inventory.actions === null || Array.isArray(inventory.actions)) {
    throw new Error(`${label} needs an actions object`);
  }
  for (const [name, entry] of Object.entries(inventory.actions as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null || !Array.isArray((entry as { majors?: unknown }).majors)) {
      throw new Error(`${label} entry ${name} needs a majors array`);
    }
    const majors = (entry as { majors: unknown[] }).majors;
    if (!majors.every(isInventoryMajor)) throw new Error(`${label} entry ${name} has a malformed major`);
  }
  return inventory as unknown as ActionsInventory;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function loadRegistryEndRules(root: string): Promise<RegistryV2Rule[]> {
  const value = await readJson(join(root, "registry/github-actions.json"));
  if (registryV2Issues(value).length > 0) throw new Error("registry/github-actions.json is invalid");
  return validateRegistryV2(value).rules;
}

export async function checkActionCoverage(root = ROOT): Promise<ActionsCoverageReport> {
  const expectedDir = join(root, "tools/coverage/expected");
  const scope = parseActionsScope(await readJson(join(expectedDir, SCOPE_NAME)));
  const inventory = parseActionsInventory(await readJson(join(expectedDir, INVENTORY_NAME)));
  const rules = await loadRegistryEndRules(root);
  const actions = scope.actions.map((action) => assessAction(action, inventory.actions[action.action]?.majors, rules));
  return { actions, complete: actions.every((action) => action.complete) };
}

export function formatCoverageText(report: ActionsCoverageReport): string {
  const lines: string[] = ["Official Actions coverage", ""];
  for (const action of report.actions) {
    if (action.coverageLimit) {
      lines.push(`${action.action}: complete (documented limit)`);
      lines.push(`  ${action.coverageLimit}`);
      continue;
    }
    if (action.complete) {
      lines.push(`${action.action}: complete`);
      continue;
    }
    lines.push(`${action.action}: gaps`);
    if (action.missingMajors.length > 0) {
      lines.push(`  missing majors: ${action.missingMajors.join(", ")}`);
    }
    for (const gap of action.gaps) {
      if (gap.major === 0) lines.push(`  ${gap.detail}`);
    }
  }
  lines.push("");
  lines.push(report.complete ? "All in-scope actions are complete." : "Coverage incomplete.");
  return `${lines.join("\n")}\n`;
}

export function formatCoverageTable(report: ActionsCoverageReport): string {
  const rows = ["| Action | Status | Missing majors |", "| --- | --- | --- |"];
  for (const action of report.actions) {
    const status = action.coverageLimit ? "limit" : action.complete ? "complete" : "gaps";
    const missing = action.missingMajors.length > 0 ? action.missingMajors.join(", ") : "—";
    rows.push(`| ${action.action} | ${status} | ${missing} |`);
  }
  return `${rows.join("\n")}\n`;
}

export async function writeCoverageDoc(report: ActionsCoverageReport, path = COVERAGE_DOC): Promise<void> {
  const existing = await readFile(path, "utf8");
  const begin = existing.indexOf(TABLE_BEGIN);
  const end = existing.indexOf(TABLE_END);
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error(`${path} is missing actions-coverage markers`);
  }
  const table = `\n\n${formatCoverageTable(report)}\n`;
  const next = `${existing.slice(0, begin + TABLE_BEGIN.length)}${table}${existing.slice(end)}`;
  await writeFile(path, next);
}

/** Marker embedded in gap issues so the weekly job can dedupe while open. */
export const ACTIONS_COVERAGE_ISSUE_MARKER = "<!-- ebb-actions-coverage-gap -->";

export function coverageIssueTitle(action: string): string {
  return `actions coverage gap: ${action}`;
}

export function coverageIssueMarker(action: string): string {
  return `${ACTIONS_COVERAGE_ISSUE_MARKER} action=${action}`;
}

export function formatCoverageIssueBody(action: ActionCoverage): string {
  const lines = [
    coverageIssueMarker(action.action),
    "",
    `The offline Actions coverage checker found gaps for **${action.action}**.`,
    "",
    "This issue is opened by the weekly importers workflow. It does not edit `registry/`.",
    "",
  ];
  if (action.missingMajors.length > 0) {
    lines.push("### Missing end rules", "", action.missingMajors.map((major) => `- [ ] \`${major}\``).join("\n"), "");
  }
  const other = action.gaps.filter((gap) => gap.major === 0);
  if (other.length > 0) {
    lines.push("### Other gaps", "", ...other.map((gap) => `- [ ] ${gap.detail}`), "");
  }
  lines.push(
    "### How to fix",
    "",
    "1. Read the action's major tags and the GitHub changelog notices linked from [`docs/coverage.md`](../blob/main/docs/coverage.md).",
    "2. Add or update rules in `registry/github-actions.json` from those sources only. Do not rename an existing rule id.",
    "3. Refresh `tools/coverage/expected/github-actions-inventory.json` if the reviewed major list changed.",
    "4. Add cases and run `npm run lint:rules` and `node dist/tools/coverage/actions.js`.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv: string[]): { writeDocs: boolean } {
  return { writeDocs: argv.includes("--write-docs") };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await checkActionCoverage();
  process.stdout.write(formatCoverageText(report));
  if (args.writeDocs) {
    await writeCoverageDoc(report);
    process.stdout.write(`Updated ${COVERAGE_DOC}\n`);
  }
  if (!report.complete) process.exitCode = EXIT_GAPS;
}

const isDirect = process.argv[1] !== undefined && /actions\.(ts|js)$/.test(process.argv[1]);
if (isDirect) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = EXIT_ERROR;
  });
}
