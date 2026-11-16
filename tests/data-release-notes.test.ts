import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { diffRules } from "../src/diff.js";
import type { RegistryV2Rule } from "../src/registry.js";
import { formatReleaseNotes } from "../tools/data-release-notes.js";

const unchangedRule: RegistryV2Rule = {
  id: "npm.package.unchanged",
  purl: "pkg:npm/unchanged",
  ecosystem: "npm",
  event: "deprecated",
  vers: "vers:npm/*",
  title: "unchanged rule",
  summary: "This rule did not change.",
  severity: "low",
  sources: [{ title: "source", url: "https://example.com/unchanged" }],
  provenance: { observedAt: "2026-10-01", reviewedAt: "2026-10-01", reviewer: "alice", method: "manual" },
};

const ruleToChangeBefore: RegistryV2Rule = {
  id: "npm.package.changed-pkg",
  purl: "pkg:npm/changed-pkg",
  ecosystem: "npm",
  event: "deprecated",
  vers: "vers:npm/<1.0.0",
  title: "changed package deprecation",
  summary: "Initial version",
  severity: "low",
  sources: [{ title: "source", url: "https://example.com/source" }],
  provenance: { observedAt: "2026-10-01", reviewedAt: "2026-10-01", reviewer: "alice", method: "manual" },
};

const ruleToChangeAfter: RegistryV2Rule = {
  ...ruleToChangeBefore,
  vers: "vers:npm/*",
  severity: "high",
  summary: "Expanded range to all versions",
};

const ruleToRemove: RegistryV2Rule = {
  id: "pypi.package.removed-pkg",
  purl: "pkg:pypi/removed-pkg",
  ecosystem: "python",
  event: "end-of-life",
  vers: "vers:pypi/<2.0",
  title: "removed python rule",
  summary: "Will be removed in next release",
  severity: "medium",
  sources: [{ title: "source", url: "https://example.com/py" }],
  provenance: { observedAt: "2026-10-01", reviewedAt: "2026-10-01", reviewer: "bob", method: "manual" },
};

const ruleToAdd: RegistryV2Rule = {
  id: "cargo.crate.new-crate",
  purl: "pkg:cargo/new-crate",
  ecosystem: "cargo",
  event: "deprecated",
  vers: "vers:cargo/*",
  title: "newly added crate",
  summary: "Brand new deprecation",
  severity: "high",
  sources: [{ title: "source", url: "https://example.com/cargo" }],
  provenance: { observedAt: "2026-11-15", reviewedAt: "2026-11-15", reviewer: "carol", method: "manual" },
};

describe("data-release-notes (release-log-3)", () => {
  it("formats release notes with all three kinds of changes and excludes unchanged rules", () => {
    const fromRules: RegistryV2Rule[] = [unchangedRule, ruleToChangeBefore, ruleToRemove];
    const toRules: RegistryV2Rule[] = [unchangedRule, ruleToChangeAfter, ruleToAdd];

    const diffResult = diffRules(fromRules, toRules);
    assert.equal(diffResult.summary.added, 1);
    assert.equal(diffResult.summary.changed, 1);
    assert.equal(diffResult.summary.removed, 1);

    const notes = formatReleaseNotes(diffResult);
    const lines = notes.split("\n");

    // First line must contain the counts
    assert.equal(lines[0], "1 added, 1 changed, 1 removed.");

    // Ecosystem headings present
    assert.ok(notes.includes("### cargo"), "cargo ecosystem heading should be present");
    assert.ok(notes.includes("### npm"), "npm ecosystem heading should be present");
    assert.ok(notes.includes("### python"), "python ecosystem heading should be present");

    // Added rule with static API link
    assert.match(
      notes,
      /- \*\*Added\*\* \[`cargo\.crate\.new-crate`\]\(https:\/\/velella\.sh\/ebb\/api\/v1\/rules\/cargo\.crate\.new-crate\.json\)/,
    );

    // Changed rule with static API link
    assert.match(
      notes,
      /- \*\*Changed\*\* \[`npm\.package\.changed-pkg`\]\(https:\/\/velella\.sh\/ebb\/api\/v1\/rules\/npm\.package\.changed-pkg\.json\)/,
    );

    // Removed rule with static API link
    assert.match(
      notes,
      /- \*\*Removed\*\* \[`pypi\.package\.removed-pkg`\]\(https:\/\/velella\.sh\/ebb\/api\/v1\/rules\/pypi\.package\.removed-pkg\.json\)/,
    );

    // Unchanged rules must not be included
    assert.ok(!notes.includes("npm.package.unchanged"), "Unchanged rules must not be included in notes");
  });

  it("formats release notes with no changes", () => {
    const fromRules: RegistryV2Rule[] = [unchangedRule];
    const toRules: RegistryV2Rule[] = [unchangedRule];

    const diffResult = diffRules(fromRules, toRules);
    assert.equal(diffResult.summary.added, 0);
    assert.equal(diffResult.summary.changed, 0);
    assert.equal(diffResult.summary.removed, 0);

    const notes = formatReleaseNotes(diffResult);
    // First line must have counts, and no rules or headings
    assert.equal(notes, "0 added, 0 changed, 0 removed.");
    assert.ok(!notes.includes("npm.package.unchanged"));
    assert.ok(!notes.includes("###"));
  });

  it("runs CLI script and writes notes and json-diff files", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ebb-rel-notes-test-"));
    const outNotes = join(tmp, "release-notes.md");
    const outDiff = join(tmp, "data-diff.json");

    try {
      execFileSync(
        process.execPath,
        [
          "dist/tools/data-release-notes.js",
          "--from",
          "bundled",
          "--to",
          "active",
          "--out",
          outNotes,
          "--json-diff",
          outDiff,
        ],
        { cwd: resolve("."), encoding: "utf8" },
      );

      const notesContent = await readFile(outNotes, "utf8");
      assert.match(notesContent, /^\d+ added, \d+ changed, \d+ removed\./);

      const diffContent = await readFile(outDiff, "utf8");
      const parsed = JSON.parse(diffContent);
      assert.equal(parsed.schemaVersion, "ebb.data-diff.v1");
      assert.ok(parsed.summary);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
