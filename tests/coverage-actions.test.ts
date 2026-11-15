import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  assessAction,
  checkActionCoverage,
  EXIT_GAPS,
  formatCoverageText,
  majorCovered,
  type ExpectedAction,
  type InventoryMajor,
} from "../tools/coverage/actions.js";
import type { RegistryV2Rule } from "../src/registry.js";

const action = (over: Partial<ExpectedAction> & Pick<ExpectedAction, "action">): ExpectedAction => ({
  repoUrl: `https://github.com/${over.action}`,
  ...over,
});

const baseRule = (over: Partial<RegistryV2Rule> & Pick<RegistryV2Rule, "id" | "vers" | "event">): RegistryV2Rule => ({
  ecosystem: "github-actions",
  purl: "pkg:github/actions/example",
  title: over.id,
  summary: over.id,
  severity: "high",
  replacement: "actions/example@v9 or later",
  sources: [{ title: "t", url: "https://example.com/", accessedAt: "2026-11-15" }],
  provenance: {
    observedAt: "2026-11-15",
    reviewedAt: "2026-11-15",
    reviewer: "unreviewed",
    method: "manual",
  },
  ...over,
});

const majors = (...entries: Array<[number, string]>): InventoryMajor[] =>
  entries.map(([major, using]) => ({ major, using, file: "action.yml" }));

test("a catch-all below the supported major covers older retired majors", () => {
  const rules = [
    baseRule({
      id: "github-actions.example.node20",
      purl: "pkg:github/actions/example",
      vers: "vers:semver/<5.0.0",
      event: "end-of-support",
    }),
  ];
  assert.equal(majorCovered(rules, "actions/example", 4), true);
  assert.equal(majorCovered(rules, "actions/example", 5), false);
  const result = assessAction(
    action({ action: "actions/example" }),
    majors([1, "node12"], [4, "node20"], [5, "node24"]),
    rules,
  );
  assert.equal(result.complete, true);
  assert.deepEqual(result.missingMajors, []);
});

test("an exact patch does not cover the major's N.0.0 probe", () => {
  const rules = [
    baseRule({
      id: "github-actions.example.exact",
      purl: "pkg:github/actions/example",
      vers: "vers:semver/1.2.3",
      event: "end-of-support",
    }),
  ];
  const result = assessAction(action({ action: "actions/example" }), majors([1, "node20"]), rules);
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingMajors, ["1 (node20)"]);
});

test("a documented coverage limit is complete even when a retired major has no rule", () => {
  const result = assessAction(
    action({
      action: "actions/typescript-action",
      coverageLimit: "Starter template.",
    }),
    majors([1, "node12"]),
    [],
  );
  assert.equal(result.complete, true);
  assert.equal(result.coverageLimit, "Starter template.");
});

test("removed counts as an end event and a different purl does not", () => {
  const rules = [
    baseRule({
      id: "github-actions.other.removed",
      purl: "pkg:github/actions/other",
      vers: "vers:semver/<9.0.0",
      event: "removed",
    }),
  ];
  const result = assessAction(action({ action: "actions/example" }), majors([1, "node16"]), rules);
  assert.equal(result.complete, false);
  assert.match(formatCoverageText({ actions: [result], complete: false }), /missing majors: 1 \(node16\)/);
});

test("checkActionCoverage reads the reviewed scope and reports it complete", async () => {
  const report = await checkActionCoverage();
  assert.equal(report.actions.length, 40);
  assert.ok(
    report.actions.some((entry) => entry.action === "actions/checkout" && entry.complete && !entry.coverageLimit),
  );
  assert.ok(report.actions.some((entry) => entry.action === "github/codeql-action" && entry.coverageLimit));
  assert.ok(report.actions.some((entry) => entry.action === "actions/typescript-action" && entry.coverageLimit));
  assert.equal(
    report.actions.some((entry) => entry.action.startsWith("docker/") || entry.action.startsWith("softprops/")),
    false,
  );
  assert.equal(report.complete, true);
  assert.match(formatCoverageText(report), /All in-scope actions are complete/);
  assert.equal(EXIT_GAPS, 1);
});

test("new node20 rules record the passed removal date as end-of-support", async () => {
  const registry = JSON.parse(await readFile("registry/github-actions.json", "utf8")) as {
    rules: Array<{
      id: string;
      event: string;
      deadline?: string;
      replacement?: string;
      provenance: { reviewer: string; reviewedAt: string };
      sources: Array<{ accessedAt: string }>;
    }>;
  };
  const node20 = [
    "github-actions.ai-inference.node20",
    "github-actions.attest.node20",
    "github-actions.delete-package-versions.node20",
    "github-actions.dependency-review-action.node20",
    "github-actions.go-dependency-submission.node20",
  ];
  for (const id of node20) {
    const rule = registry.rules.find((entry) => entry.id === id);
    assert.ok(rule, id);
    assert.equal(rule.event, "end-of-support");
    assert.equal(rule.deadline, "2026-09-23");
    assert.equal(rule.provenance.reviewer, "unreviewed");
    assert.equal(rule.provenance.reviewedAt, "2026-11-15");
    assert.ok(rule.sources.every((source) => source.accessedAt === "2026-11-15"));
  }
  const byId = (id: string) => registry.rules.find((entry) => entry.id === id)!;
  assert.match(byId("github-actions.ai-inference.node20").replacement ?? "", /@v2/);
  assert.match(byId("github-actions.attest.node20").replacement ?? "", /@v3/);
  assert.match(byId("github-actions.dependency-review-action.node20").replacement ?? "", /@v5/);
  assert.doesNotMatch(byId("github-actions.delete-package-versions.node20").replacement ?? "", /@v[1-5]/);
  assert.doesNotMatch(byId("github-actions.go-dependency-submission.node20").replacement ?? "", /@v[12]/);
  assert.equal(byId("github-actions.delete-package-versions.node12").deadline, "2023-08-14");
  assert.equal(byId("github-actions.go-dependency-submission.node16").deadline, "2024-11-12");
});

test("checkActionCoverage fails closed when a retired major has no rule", async () => {
  const root = await mkdtemp(join(tmpdir(), "ebb-actions-coverage-"));
  try {
    await mkdir(join(root, "tools/coverage/expected"), { recursive: true });
    await mkdir(join(root, "registry"), { recursive: true });
    await writeFile(
      join(root, "tools/coverage/expected/github-actions.json"),
      JSON.stringify({
        schemaVersion: "ebb.actions-scope.v1",
        reviewedAt: "2026-11-15",
        sources: [{ title: "t", url: "https://example.com/", accessedAt: "2026-11-15" }],
        actions: [{ action: "actions/example", repoUrl: "https://github.com/actions/example" }],
      }),
    );
    await writeFile(
      join(root, "tools/coverage/expected/github-actions-inventory.json"),
      JSON.stringify({
        schemaVersion: "ebb.actions-inventory.v1",
        reviewedAt: "2026-11-15",
        retiredRuntimes: ["node12", "node16", "node20"],
        actions: {
          "actions/example": { majors: [{ major: 1, using: "node20", file: "action.yml" }] },
        },
      }),
    );
    await writeFile(
      join(root, "registry/github-actions.json"),
      JSON.stringify({ schemaVersion: "ebb.registry.v2", ecosystem: "github-actions", rules: [] }),
    );
    const report = await checkActionCoverage(root);
    assert.equal(report.complete, false);
    assert.deepEqual(report.actions[0]?.missingMajors, ["1 (node20)"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
