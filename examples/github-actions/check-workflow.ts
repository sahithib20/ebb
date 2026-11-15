/**
 * Example: Inspecting GitHub Actions workflows for deprecated or unsupported actions.
 *
 * Usage:
 *   node --experimental-strip-types examples/github-actions/check-workflow.ts [path/to/workflow.yml]
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check, replacementFor } from "../../dist/src/index.js";

const SHA = /^[0-9a-f]{40}$/i;
const USES =
  /uses:\s*["']?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)@([0-9a-fA-F]{40}|[A-Za-z0-9_.-]+)["']?/;

interface ShaMapFile {
  actions: Record<string, Record<string, string>>;
}

let shaTags: Record<string, Record<string, string>> | undefined;

function releaseTag(repo: string, sha: string): string | undefined {
  if (!shaTags) {
    const mapPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../registry/github-actions-shas.json");
    shaTags = (JSON.parse(readFileSync(mapPath, "utf8")) as ShaMapFile).actions;
  }
  return shaTags[repo.toLowerCase()]?.[sha.toLowerCase()];
}

/** `owner/repo` or `owner/repo/subpath` → `pkg:github/owner/repo` or `pkg:github/owner/repo#subpath`. */
export function actionPurl(action: string): string {
  const [owner, repo, subpath] = action.split("/");
  if (!owner || !repo) throw new Error(`Invalid action reference: ${action}`);
  return subpath ? `pkg:github/${owner}/${repo}#${subpath}` : `pkg:github/${owner}/${repo}`;
}

/** A 40-character pin becomes the release tag recorded for that commit. Other refs are unchanged. */
export function versionForRef(action: string, ref: string): string {
  if (!SHA.test(ref)) return ref;
  const repo = action.split("/").slice(0, 2).join("/");
  const tag = releaseTag(repo, ref);
  if (!tag) throw new Error(`No release tag for ${repo}@${ref} in registry/github-actions-shas.json`);
  return tag;
}

export interface GitHubActionReference {
  action: string;
  ref: string;
  purl: string;
  line: number;
}

export function parseWorkflowFile(workflowPath: string): GitHubActionReference[] {
  if (!existsSync(workflowPath)) {
    throw new Error(`Workflow file not found at: ${workflowPath}`);
  }

  const content = readFileSync(workflowPath, "utf-8");
  const lines = content.split("\n");
  const actions: GitHubActionReference[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (!raw || raw.startsWith("#")) continue;

    // `uses: actions/checkout@v2`, `uses: github/codeql-action/init@v3`, or a 40-character SHA pin.
    const match = raw.match(USES);
    if (match && match[1] && match[2]) {
      const actionName = match[1];
      const actionRef = match[2];
      actions.push({
        action: actionName,
        ref: actionRef,
        purl: actionPurl(actionName),
        line: i + 1,
      });
    }
  }

  return actions;
}

export function evaluateWorkflow(workflowPath: string) {
  const actions = parseWorkflowFile(workflowPath);
  const results = actions.map((item) => {
    const version = versionForRef(item.action, item.ref);
    const evaluation = check(item.purl, version);
    const repl = replacementFor(item.purl, version) ?? evaluation.matches[0]?.replacement;
    return {
      ...item,
      status: evaluation.status,
      rule: evaluation.matches[0]?.ruleId,
      replacement: repl,
      evaluation,
    };
  });

  return {
    workflowPath,
    total: actions.length,
    results,
    findings: results.filter((r) => r.status !== "ok"),
  };
}

// Execute when invoked directly
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  const targetPath = resolve(process.argv[2] ?? resolve(dirname(__filename), "workflow.yml"));
  console.log(`Scanning GitHub Actions workflow at: ${targetPath}\n`);

  const report = evaluateWorkflow(targetPath);

  console.log(`Evaluated ${report.total} action reference(s):`);
  for (const item of report.results) {
    const symbol = item.status === "ok" ? "✓" : "✖";
    console.log(`  ${symbol} line ${item.line}: ${item.action}@${item.ref} -> ${item.status}`);
  }

  if (report.findings.length > 0) {
    console.log("\n⚠️  Identified Deprecated or Unsupported Actions:");
    for (const item of report.findings) {
      console.log(`\n• Line ${item.line}: ${item.action}@${item.ref} (${item.purl}@${item.ref}) -> ${item.status.toUpperCase()}`);
      if (item.rule) console.log(`  Rule: ${item.rule}`);
      if (item.replacement) console.log(`  Replacement: ${item.replacement}`);
    }
  } else {
    console.log("\n✅ All GitHub Actions in this workflow are active and supported.");
  }
}
