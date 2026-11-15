import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { INVENTORY_PATH, stageInventoryBranch } from "../tools/coverage/publish-inventory-pr.js";

async function repoWithTarget(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "ebb-inventory-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  await mkdir(join(repo, "tools/coverage/expected"), { recursive: true });
  await writeFile(join(repo, INVENTORY_PATH), '{"reviewed":1}\n');
  await writeFile(join(repo, "README.md"), "target\n");
  git("add", ".");
  git("commit", "-m", "target");
  git("checkout", "-b", "feature");
  await writeFile(join(repo, "extra.txt"), "feature only\n");
  git("add", "extra.txt");
  git("commit", "-m", "feature");
  return repo;
}

test("a changed inventory branch is cut from the target and contains only that file", async () => {
  const repo = await repoWithTarget();
  try {
    const result = stageInventoryBranch({
      repo,
      target: "main",
      branch: "importers/actions-inventory",
      contents: '{"reviewed":2}\n',
    });
    assert.equal(result.status, "ready");
    assert.deepEqual(result.files, [INVENTORY_PATH]);
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(git("show", "importers/actions-inventory:README.md"), "target\n");
    assert.throws(() => git("show", "importers/actions-inventory:extra.txt"));
    assert.equal(git("merge-base", "main", "importers/actions-inventory").trim(), git("rev-parse", "main").trim());
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("an inventory that already matches the target is a no-change", async () => {
  const repo = await repoWithTarget();
  try {
    const contents = await readFile(join(repo, INVENTORY_PATH), "utf8");
    const result = stageInventoryBranch({
      repo,
      target: "main",
      branch: "importers/actions-inventory",
      contents,
    });
    assert.equal(result.status, "no-change");
    assert.deepEqual(result.files, []);
    assert.throws(() =>
      execFileSync("git", ["rev-parse", "importers/actions-inventory"], { cwd: repo, stdio: "ignore" }),
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
