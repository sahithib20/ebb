import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateSiteData } from "../tools/site-data/generate.js";

/**
 * Field name snapshot per record type and collection file for Site Data v1.
 * Site Data v1 stability contract: v1 only gains fields and files.
 * Existing field names and files must never be removed or renamed.
 */
export const SITE_DATA_V1_SNAPSHOT: Record<string, string[]> = {
  component: [
    "dates",
    "ecosystem",
    "id",
    "links",
    "name",
    "nextEvent",
    "purl",
    "recordType",
    "rules",
    "slug",
    "status",
    "summary",
    "title",
  ],
  rule: [
    "affectedRange",
    "dates",
    "event",
    "id",
    "links",
    "recordType",
    "reviewDate",
    "slug",
    "sources",
    "status",
    "summary",
    "title",
  ],
  "release-line": [
    "dates",
    "endDate",
    "id",
    "line",
    "links",
    "recordType",
    "ruleId",
    "slug",
    "status",
    "summary",
    "title",
    "vers",
  ],
  "components.json": ["dataVersion", "records", "type"],
  "rules.json": ["dataVersion", "records", "type"],
  "lines.json": ["dataVersion", "records", "type"],
  "ecosystems.json": ["dataVersion", "ecosystems"],
  "upcoming.json": ["dataVersion", "months"],
  "releases.json": ["dataVersion", "releases"],
  "index.json": ["componentCount", "dataVersion", "ecosystemCount", "files", "generatedAt", "lineCount", "ruleCount"],
};

export function verifySiteDataCompatibility(
  target: string,
  actualKeys: string[],
  snapshot: Record<string, string[]> = SITE_DATA_V1_SNAPSHOT,
): void {
  const expectedKeys = snapshot[target];
  if (!expectedKeys) {
    throw new Error(`Target "${target}" is missing from the compatibility snapshot.`);
  }

  const actualSet = new Set(actualKeys);
  const missingFields = expectedKeys.filter((k) => !actualSet.has(k));

  if (missingFields.length > 0) {
    throw new Error(
      `Backward compatibility break in ${target}: missing field(s) ${missingFields.map((f) => `"${f}"`).join(", ")}`,
    );
  }
}

test("site data v1 generated output satisfies field name snapshot for all record types and collection files", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ebb-site-data-compat-test-"));
  try {
    await generateSiteData({
      outDir: tempDir,
    });

    // Check collection files
    const collectionFiles = [
      "components.json",
      "rules.json",
      "lines.json",
      "ecosystems.json",
      "upcoming.json",
      "releases.json",
      "index.json",
    ];

    for (const relPath of collectionFiles) {
      const content = await readFile(join(tempDir, relPath), "utf8");
      const doc = JSON.parse(content) as Record<string, unknown>;
      verifySiteDataCompatibility(relPath, Object.keys(doc));
    }

    // Check individual records
    const compContent = await readFile(join(tempDir, "components/npm-request.json"), "utf8");
    verifySiteDataCompatibility("component", Object.keys(JSON.parse(compContent)));

    const ruleContent = await readFile(join(tempDir, "rules/npm-package-request-deprecated.json"), "utf8");
    verifySiteDataCompatibility("rule", Object.keys(JSON.parse(ruleContent)));

    const lineContent = await readFile(join(tempDir, "lines/nodejs-nodejs-line-20-x.json"), "utf8");
    verifySiteDataCompatibility("release-line", Object.keys(JSON.parse(lineContent)));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("removing a field in a test branch makes the compatibility test fail", () => {
  // Simulate removing "status" from component
  const brokenComponentKeys = [
    "dates",
    "ecosystem",
    "id",
    "links",
    "name",
    "nextEvent",
    "purl",
    "recordType",
    "rules",
    "slug",
    "summary",
    "title",
  ];

  assert.throws(
    () => verifySiteDataCompatibility("component", brokenComponentKeys),
    (err: Error) => {
      assert.match(err.message, /Backward compatibility break in component: missing field\(s\) "status"/);
      return true;
    },
  );
});

test("removing a target record type or file makes the compatibility test fail", () => {
  assert.throws(
    () => verifySiteDataCompatibility("unregistered-type", ["a", "b"]),
    (err: Error) => {
      assert.match(err.message, /missing from the compatibility snapshot/);
      return true;
    },
  );
});
