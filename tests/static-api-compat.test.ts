import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateStaticApi } from "../tools/static-api/generate.js";

/**
 * Shape snapshot of field names per endpoint for Static API v1.
 * Static API v1 stability promise: v1 only gains fields and endpoints.
 * Existing field names and endpoints must never be removed or renamed.
 */
export const STATIC_API_V1_SNAPSHOT: Record<string, string[]> = {
  "/meta.json": [
    "$schema",
    "componentsCount",
    "dataVersion",
    "ecosystemsCount",
    "rulesCount",
    "schemaVersion",
    "schemaVersions",
    "version",
  ],
  "/all.json": [
    "$schema",
    "componentsCount",
    "ecosystemsCount",
    "generatedAt",
    "gzipBytes",
    "rawBytes",
    "rules",
    "rulesCount",
    "schemaVersion",
    "version",
  ],
  "/index.json": [
    "$schema",
    "components",
    "ecosystemsCount",
    "freshness",
    "generatedAt",
    "rulesCount",
    "schemaVersion",
    "version",
  ],
  "/ecosystems.json": ["$schema", "ecosystems", "ecosystemsCount", "generatedAt", "schemaVersion", "version"],
  "/upcoming.json": ["$schema", "count", "generatedAt", "schemaVersion", "upcoming", "version"],
  "/recent.json": ["$schema", "count", "generatedAt", "recent", "schemaVersion", "version"],
  "/search-index.json": ["$schema", "generatedAt", "items", "prefixes", "schemaVersion", "version"],
  "/{type}/{name}.json": [
    "$schema",
    "ecosystems",
    "generatedAt",
    "name",
    "purl",
    "rules",
    "schemaVersion",
    "type",
    "version",
    "versions",
  ],
  "/{ecosystem}.json": [
    "$schema",
    "componentsCount",
    "ecosystem",
    "generatedAt",
    "provenance",
    "rules",
    "rulesCount",
    "schemaVersion",
    "version",
  ],
  "/rules/{rule-id}.json": ["$schema", "generatedAt", "rule", "schemaVersion", "version"],
  "/openapi.json": ["components", "info", "openapi", "paths", "servers"],
  "/404.json": ["$schema", "error", "message", "schemaVersion"],
};

export function verifyApiCompatibility(
  endpoint: string,
  actualKeys: string[],
  snapshot: Record<string, string[]> = STATIC_API_V1_SNAPSHOT,
): void {
  const expectedKeys = snapshot[endpoint];
  if (!expectedKeys) {
    throw new Error(`Endpoint "${endpoint}" is missing from the compatibility snapshot.`);
  }

  const actualSet = new Set(actualKeys);
  const missingFields = expectedKeys.filter((k) => !actualSet.has(k));

  if (missingFields.length > 0) {
    throw new Error(
      `Backward compatibility break in ${endpoint}: missing field(s) ${missingFields.map((f) => `"${f}"`).join(", ")}`,
    );
  }
}

test("static API v1 generated output satisfies field name snapshot for all endpoints", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ebb-compat-test-"));
  try {
    await generateStaticApi({
      outDir: tempDir,
      createdAt: "2026-11-12T00:00:00.000Z",
    });

    const endpointFiles: Record<string, string> = {
      "/meta.json": "meta.json",
      "/all.json": "all.json",
      "/index.json": "index.json",
      "/ecosystems.json": "ecosystems.json",
      "/upcoming.json": "upcoming.json",
      "/recent.json": "recent.json",
      "/search-index.json": "search-index.json",
      "/{type}/{name}.json": "npm/request.json",
      "/{ecosystem}.json": "npm.json",
      "/rules/{rule-id}.json": "rules/npm.package.request.deprecated.json",
      "/openapi.json": "openapi.json",
      "/404.json": "404.json",
    };

    for (const [endpoint, relPath] of Object.entries(endpointFiles)) {
      const content = await readFile(join(tempDir, relPath), "utf8");
      const doc = JSON.parse(content) as Record<string, unknown>;
      const actualKeys = Object.keys(doc);
      verifyApiCompatibility(endpoint, actualKeys);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("removing a field in a test branch makes the compatibility test fail", () => {
  // Simulating removing "version" from /meta.json
  const brokenMetaKeys = [
    "$schema",
    "componentsCount",
    "dataVersion",
    "ecosystemsCount",
    "rulesCount",
    "schemaVersion",
    "schemaVersions",
  ];

  assert.throws(
    () => verifyApiCompatibility("/meta.json", brokenMetaKeys),
    (err: Error) => {
      assert.match(err.message, /Backward compatibility break in \/meta\.json: missing field\(s\) "version"/);
      return true;
    },
  );
});

test("removing an endpoint makes the compatibility test fail", () => {
  assert.throws(
    () => verifyApiCompatibility("/unregistered.json", ["a", "b"]),
    (err: Error) => {
      assert.match(err.message, /missing from the compatibility snapshot/);
      return true;
    },
  );
});
