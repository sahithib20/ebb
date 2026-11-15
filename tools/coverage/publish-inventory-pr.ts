// Opens an inventory-only pull request from the default branch.
//
//   node dist/tools/coverage/publish-inventory-pr.js
//
// Reads the already-refreshed inventory file, branches from the target, and copies
// only that file. Refuses to push unless the diff against the target is exactly that file.
// Prints "no change" when the refreshed bytes already match the target.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const INVENTORY_PATH = "tools/coverage/expected/github-actions-inventory.json";

export function git(repo: string, args: string[], options?: { allowFailure?: boolean }): string {
  try {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (options?.allowFailure) return "";
    throw error;
  }
}

export function fileAt(repo: string, ref: string, path: string): string | undefined {
  const text = git(repo, ["show", `${ref}:${path}`], { allowFailure: true });
  return text === "" ? undefined : text;
}

/** Names changed between the target and head. Three-dot, so it is the PR diff. */
export function diffNames(repo: string, target: string, head: string): string[] {
  return git(repo, ["diff", "--name-only", `${target}...${head}`])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface PublishResult {
  status: "no-change" | "ready";
  files: string[];
  branch: string;
}

/**
 * Create `branch` from `target` and commit only `inventoryPath` when `contents` differ.
 * Does not push. Throws when the resulting diff is not exactly that file.
 */
export function stageInventoryBranch(options: {
  repo: string;
  target: string;
  branch: string;
  inventoryPath?: string;
  contents: string;
}): PublishResult {
  const inventoryPath = options.inventoryPath ?? INVENTORY_PATH;
  const current = fileAt(options.repo, options.target, inventoryPath);
  if (current === options.contents) {
    return { status: "no-change", files: [], branch: options.branch };
  }

  const parent = mkdtempSync(join(tmpdir(), "ebb-inventory-"));
  const work = join(parent, "wt");
  try {
    git(options.repo, ["worktree", "add", "-B", options.branch, work, options.target]);
    mkdirSync(dirname(join(work, inventoryPath)), { recursive: true });
    writeFileSync(join(work, inventoryPath), options.contents);
    git(work, ["add", "--", inventoryPath]);
    const staged = git(work, ["diff", "--cached", "--name-only"])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (staged.length !== 1 || staged[0] !== inventoryPath) {
      throw new Error(`refusing to commit: staged files are ${staged.join(", ") || "(none)"}`);
    }
    git(work, [
      "-c",
      "user.name=github-actions[bot]",
      "-c",
      "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "commit",
      "-m",
      "chore: refresh the GitHub Actions inventory snapshot",
    ]);
    const files = diffNames(work, options.target, "HEAD");
    if (files.length !== 1 || files[0] !== inventoryPath) {
      throw new Error(`refusing to push: diff against ${options.target} is ${files.join(", ") || "(empty)"}`);
    }
    return { status: "ready", files, branch: options.branch };
  } finally {
    git(options.repo, ["worktree", "remove", "--force", work], { allowFailure: true });
    rmSync(parent, { recursive: true, force: true });
  }
}

function pushAndOpen(repo: string, branch: string, target: string): void {
  git(repo, ["push", "--force", "origin", `${branch}:${branch}`]);
  const title = "chore: refresh the GitHub Actions inventory";
  const body = "Refreshes `tools/coverage/expected/github-actions-inventory.json` only. It does not edit `registry/`.";
  let state: string | undefined;
  try {
    const viewed = execFileSync("gh", ["pr", "view", branch, "--json", "state"], { cwd: repo, encoding: "utf8" });
    state = (JSON.parse(viewed) as { state?: string }).state;
  } catch {
    state = undefined;
  }
  if (state === "OPEN") {
    execFileSync("gh", ["pr", "edit", branch, "--title", title, "--body", body], { cwd: repo, stdio: "inherit" });
    return;
  }
  execFileSync("gh", ["pr", "create", "--head", branch, "--base", target, "--title", title, "--body", body], {
    cwd: repo,
    stdio: "inherit",
  });
}

function main(): void {
  const repo = process.cwd();
  const targetName = process.env.DEFAULT_BRANCH;
  if (!targetName) throw new Error("DEFAULT_BRANCH is required");
  git(repo, ["fetch", "origin", targetName]);
  const target = `origin/${targetName}`;
  const contents = readFileSync(join(repo, INVENTORY_PATH), "utf8");
  const result = stageInventoryBranch({
    repo,
    target,
    branch: "importers/actions-inventory",
    contents,
  });
  if (result.status === "no-change") {
    process.stdout.write("no change\n");
    return;
  }
  process.stdout.write(`inventory diff: ${result.files.join(" ")}\n`);
  pushAndOpen(repo, result.branch, targetName);
}

const isDirect = process.argv[1] !== undefined && /publish-inventory-pr\.(ts|js)$/.test(process.argv[1]);
if (isDirect) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
