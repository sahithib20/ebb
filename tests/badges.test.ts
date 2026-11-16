import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  CONFIDENCE_COUNTS_END,
  CONFIDENCE_COUNTS_START,
  generateDataBadges,
  STATUS_COUNTS_END,
  STATUS_COUNTS_START,
  updateConfidenceDoc,
} from "../tools/badges.js";

test("generateDataBadges writes rules, stale-rules, and sources-verified endpoint JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ebb-badges-"));
  try {
    const { totalRules, staleRules, fileCount, verifiedSources } = await generateDataBadges(
      "registry",
      dir,
      "2026-11-14",
    );
    assert.ok(fileCount > 0);
    assert.ok(totalRules > 0);
    assert.equal(staleRules, 0);
    assert.ok(verifiedSources > 0);

    const rules = JSON.parse(await readFile(join(dir, "rules.json"), "utf8"));
    assert.equal(rules.label, "rules");
    assert.equal(rules.message, String(totalRules));

    const staleBadge = JSON.parse(await readFile(join(dir, "stale-rules.json"), "utf8"));
    assert.equal(staleBadge.label, "stale rules");
    assert.equal(staleBadge.message, "0");
    assert.equal(staleBadge.color, "3F6E66");

    const verifiedBadge = JSON.parse(await readFile(join(dir, "sources-verified.json"), "utf8"));
    assert.equal(verifiedBadge.label, "sources verified");
    assert.equal(verifiedBadge.message, String(verifiedSources));
    assert.equal(verifiedBadge.color, "3F6E66");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generateDataBadges updates status counts in freshness doc", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ebb-badges-doc-"));
  try {
    const docPath = join(dir, "freshness.md");
    const initialContent = `# Freshness\n\n${STATUS_COUNTS_START}\nold\n${STATUS_COUNTS_END}\n`;
    await writeFile(docPath, initialContent, "utf8");

    await generateDataBadges("registry", dir, "2026-11-14", docPath);

    const updated = await readFile(docPath, "utf8");
    assert.ok(updated.includes("| `ok` |"));
    assert.ok(updated.includes("| `stale` |"));
    assert.ok(!updated.includes("old"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generateDataBadges counts rules by confidence and updates confidence doc", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ebb-badges-conf-"));
  try {
    const docPath = join(dir, "confidence.md");
    const initialContent = `# Confidence\n\n${CONFIDENCE_COUNTS_START}\nplaceholder\n${CONFIDENCE_COUNTS_END}\n`;
    await writeFile(docPath, initialContent, "utf8");

    const result = await generateDataBadges(
      "registry",
      dir,
      "2026-11-14",
      join(dir, "non-existent-freshness.md"),
      undefined,
      docPath,
    );

    assert.ok(result.confidenceCounts.confirmed > 0);
    assert.ok(result.confidenceCounts.likely > 0);
    assert.ok(result.confidenceCounts.tentative > 0);
    assert.equal(
      result.confidenceCounts.confirmed + result.confidenceCounts.likely + result.confidenceCounts.tentative,
      result.totalRules,
    );

    const updated = await readFile(docPath, "utf8");
    assert.ok(updated.includes("| `confirmed` |"));
    assert.ok(updated.includes("| `likely` |"));
    assert.ok(updated.includes("| `tentative` |"));
    assert.ok(!updated.includes("placeholder"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("updateConfidenceDoc returns false when markers are missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ebb-badges-missing-"));
  try {
    const docPath = join(dir, "confidence.md");
    await writeFile(docPath, "No markers here", "utf8");
    const ok = await updateConfidenceDoc(docPath, { confirmed: 1, likely: 2, tentative: 0 });
    assert.equal(ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
