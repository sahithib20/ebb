import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

import { buildDataBundle, DataBundleError, serializeDataBundle } from "../src/data-bundle.js";
import {
  configureActiveData,
  DataPinError,
  getActiveData,
  resolveActiveDataSync,
  verifyDataBundle,
} from "../src/data-source.js";

const roots: string[] = [];

after(async () => {
  configureActiveData({});
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test("getActiveData rejects for a missing pin instead of throwing synchronously", async () => {
  const cache = await mkdtemp(join(tmpdir(), "ebb-data-source-"));
  roots.push(cache);
  configureActiveData({ pinnedVersion: "2099.01.01", cacheDirectory: cache });

  let syncThrow = false;
  let pending: ReturnType<typeof getActiveData> | undefined;
  try {
    pending = getActiveData();
  } catch {
    syncThrow = true;
  }
  assert.equal(syncThrow, false);
  assert.ok(pending);
  await assert.rejects(pending, (error: unknown) => error instanceof DataPinError && error.missing === true);
  configureActiveData({});
});

test("verifyDataBundle enforces minimumEbbVersion using strict SemVer precedence", async () => {
  const bundle = await buildDataBundle({
    root: resolve("."),
    createdAt: "2026-10-16T09:30:00Z",
    minimumEbbVersion: "0.2.0",
  });
  const bytes = Buffer.from(serializeDataBundle(bundle), "utf8");
  const verifySignature = () => ({ identity: "ci@example.com", issuer: "https://token.actions.githubusercontent.com" });

  for (const okVersion of ["0.2.0", "0.2.0+build.1", "0.2.1", "1.0.0"]) {
    const verified = verifyDataBundle(bytes, "{}", { ebbVersion: okVersion, verifySignature });
    assert.equal(verified.bundle.manifest.minimumEbbVersion, "0.2.0");
  }
  for (const oldVersion of ["0.1.9", "0.2.0-rc.1"]) {
    assert.throws(
      () => verifyDataBundle(bytes, "{}", { ebbVersion: oldVersion, verifySignature }),
      (error: unknown) => error instanceof DataBundleError && error.message === "The bundle needs Ebb 0.2.0 or newer.",
    );
  }
});

test("falls back to bundled data when cache has truncated JSON, without deleting corrupt file (cache-5)", async () => {
  const cache = await mkdtemp(join(tmpdir(), "ebb-corrupt-json-"));
  roots.push(cache);
  const version = "2026.11.20";
  const versionDir = join(cache, "data", version);
  await mkdir(versionDir, { recursive: true });
  await writeFile(join(cache, "data", "active.json"), JSON.stringify({ version }) + "\n");
  const corruptPath = join(versionDir, "bundle.json");
  await writeFile(corruptPath, '{"manifest":{"version":"2026.11.20"');
  await writeFile(join(versionDir, "bundle.json.sigstore.json"), "{}");

  const active = resolveActiveDataSync({ cacheDirectory: cache });
  assert.equal(active.info.source, "bundled");
  assert.ok(active.info.warnings.some((w) => w.includes("Ignoring downloaded lifecycle data 2026.11.20")));
  assert.ok(existsSync(corruptPath), "bad file must not be deleted");
});

test("falls back to bundled data when cache has bad signature, without deleting corrupt file (cache-5)", async () => {
  const cache = await mkdtemp(join(tmpdir(), "ebb-corrupt-sig-"));
  roots.push(cache);
  const version = "2026.11.20";
  const versionDir = join(cache, "data", version);
  await mkdir(versionDir, { recursive: true });
  await writeFile(join(cache, "data", "active.json"), JSON.stringify({ version }) + "\n");
  const bundle = await buildDataBundle({
    root: resolve("."),
    createdAt: "2026-11-20T00:00:00Z",
    minimumEbbVersion: "0.2.0",
    ecosystem: "npm",
  });
  const bundlePath = join(versionDir, "bundle.json");
  const sigPath = join(versionDir, "bundle.json.sigstore.json");
  await writeFile(bundlePath, JSON.stringify(bundle));
  await writeFile(sigPath, "not valid sigstore json");

  const active = resolveActiveDataSync({ cacheDirectory: cache });
  assert.equal(active.info.source, "bundled");
  assert.ok(active.info.warnings.some((w) => w.includes("Ignoring downloaded lifecycle data 2026.11.20")));
  assert.ok(existsSync(bundlePath), "bundle file must not be deleted");
  assert.ok(existsSync(sigPath), "signature file must not be deleted");
});
