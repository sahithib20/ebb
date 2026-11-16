import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { buildDataBundle } from "../src/data-bundle.js";
import { appendReleaseLog } from "../src/data-release-log.js";
import { isDataReleaseNeeded } from "../tools/data-release-needed.js";

const execFileAsync = promisify(execFile);
const root = resolve(".");

let tempDir = "";

before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ebb-data-needed-test-"));
});

after(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

test("data-release-needed: empty log reports changed", async () => {
  // Empty text
  assert.equal(await isDataReleaseNeeded({ logText: "", root }), "changed");

  // Missing / non-existent log file
  assert.equal(await isDataReleaseNeeded({ logPath: join(tempDir, "does-not-exist.jsonl"), root }), "changed");

  // Empty file
  const emptyFile = join(tempDir, "empty.jsonl");
  await writeFile(emptyFile, "");
  assert.equal(await isDataReleaseNeeded({ logPath: emptyFile, root }), "changed");
});

test("data-release-needed: reports unchanged when registry matches last log entry", async () => {
  const bundle = await buildDataBundle({
    root,
    createdAt: "2026-10-16T09:30:00Z",
    minimumEbbVersion: "0.1.0",
  });

  const logText = appendReleaseLog("", {
    version: "2026.10.16",
    contentDigest: bundle.manifest.contentDigest,
    bundleSha256: "sha256:" + "0".repeat(64),
    createdAt: "2026-10-16T09:30:00Z",
  });

  const result = await isDataReleaseNeeded({ logText, root });
  assert.equal(result, "unchanged");
});

test("data-release-needed: reports changed when registry data was modified", async () => {
  // Older log entry with a different content digest
  const logText = appendReleaseLog("", {
    version: "2026.10.16",
    contentDigest: "sha256:" + "f".repeat(64),
    bundleSha256: "sha256:" + "0".repeat(64),
    createdAt: "2026-10-16T09:30:00Z",
  });

  const result = await isDataReleaseNeeded({ logText, root });
  assert.equal(result, "changed");
});

test("data-release-needed: ignores non-registry files that do not alter the bundle content", async () => {
  const bundle = await buildDataBundle({
    root,
    createdAt: "2026-10-16T09:30:00Z",
    minimumEbbVersion: "0.1.0",
  });

  const logText = appendReleaseLog("", {
    version: "2026.10.16",
    contentDigest: bundle.manifest.contentDigest,
    bundleSha256: "sha256:" + "0".repeat(64),
    createdAt: "2026-10-16T09:30:00Z",
  });

  // Create a copy of repo root in temp dir
  const isolatedDir = join(tempDir, "isolated-root");
  await cp(root, isolatedDir, { recursive: true });

  // Modify a non-registry file (e.g. README or package.json)
  await writeFile(join(isolatedDir, "README.md"), "Modified README content");

  const result = await isDataReleaseNeeded({ logText, root: isolatedDir });
  assert.equal(result, "unchanged");

  // Now modify a registry file
  const npmPath = join(isolatedDir, "registry/npm.json");
  const npmData = JSON.parse(await readFile(npmPath, "utf8")) as { rules: Array<{ summary: string }> };
  npmData.rules[0]!.summary += " (test modified)";
  await writeFile(npmPath, JSON.stringify(npmData));

  const changedResult = await isDataReleaseNeeded({ logText, root: isolatedDir });
  assert.equal(changedResult, "changed");
});

test("data-release-needed: CLI exits 0 and prints changed or unchanged", async () => {
  const cliScript = resolve("dist/tools/data-release-needed.js");

  // CLI with empty log
  const emptyLog = join(tempDir, "cli-empty.jsonl");
  await writeFile(emptyLog, "");
  const { stdout: out1 } = await execFileAsync("node", [cliScript, emptyLog]);
  assert.equal(out1.trim(), "changed");

  // CLI with matching log
  const bundle = await buildDataBundle({
    root,
    createdAt: "2026-10-16T09:30:00Z",
    minimumEbbVersion: "0.1.0",
  });
  const matchLog = join(tempDir, "cli-match.jsonl");
  await writeFile(
    matchLog,
    appendReleaseLog("", {
      version: "2026.10.16",
      contentDigest: bundle.manifest.contentDigest,
      bundleSha256: "sha256:" + "0".repeat(64),
      createdAt: "2026-10-16T09:30:00Z",
    }),
  );
  const { stdout: out2 } = await execFileAsync("node", [cliScript, matchLog]);
  assert.equal(out2.trim(), "unchanged");
});
