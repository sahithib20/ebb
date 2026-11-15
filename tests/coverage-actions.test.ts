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
  parseActionsScope,
  versionCovered,
  type ExpectedAction,
  type InventoryMajor,
  type InventoryRelease,
} from "../tools/coverage/actions.js";
import { releasesToRecord } from "../tools/coverage/refresh-actions-inventory.js";
import type { RegistryV2Rule } from "../src/registry.js";

const action = (over: Partial<ExpectedAction> & Pick<ExpectedAction, "action">): ExpectedAction => ({
  repoUrl: `https://github.com/${over.action.split("/").slice(0, 2).join("/")}`,
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

test("a coverage limit does not hide a retired runtime the inventory lists", () => {
  const result = assessAction(
    action({
      action: "actions/typescript-action",
      coverageLimit: "Starter template.",
    }),
    majors([1, "node12"]),
    [],
  );
  assert.equal(result.complete, false);
  assert.equal(result.coverageLimit, "Starter template.");
  assert.deepEqual(result.missingMajors, ["1 (node12)"]);
});

test("a coverage limit stays complete when the inventory has no retired JavaScript runtime", () => {
  const composite = assessAction(
    action({ action: "actions/upload-pages-artifact", coverageLimit: "Composite action." }),
    majors([1, "composite"], [3, "composite"]),
    [],
  );
  const current = assessAction(
    action({ action: "actions/example", coverageLimit: "Nothing retired." }),
    majors([1, "node24"]),
    [],
  );
  assert.equal(composite.complete, true);
  assert.equal(current.complete, true);
  assert.deepEqual(current.missingMajors, []);
});

test("missing inventory is incomplete, including when a coverage limit is set", () => {
  const plain = assessAction(action({ action: "actions/example" }), undefined, []);
  const limited = assessAction(
    action({ action: "actions/example", coverageLimit: "Starter template." }),
    undefined,
    [],
  );
  assert.equal(plain.complete, false);
  assert.equal(limited.complete, false);
  assert.match(plain.gaps[0]?.detail ?? "", /missing from the reviewed inventory/);
  assert.match(formatCoverageText({ actions: [limited], complete: false }), /missing from the reviewed inventory/);
});

test("a supported node24 release is not flagged", () => {
  const result = assessAction(action({ action: "actions/example" }), majors([6, "node24"]), []);
  assert.equal(result.complete, true);
  assert.deepEqual(result.missingMajors, []);
});

test("a patch boundary is covered by the release list, not only the major tag", () => {
  const releases: InventoryRelease[] = [
    { version: "6.0.0", using: "node20", file: "action.yml" },
    { version: "6.1.0", using: "node20", file: "action.yml" },
    { version: "6.2.0", using: "node24", file: "action.yml" },
  ];
  const rules = [
    baseRule({
      id: "github-actions.setup-go.node20",
      purl: "pkg:github/actions/setup-go",
      vers: "vers:semver/<6.2.0",
      event: "end-of-support",
    }),
  ];
  const hidden = assessAction(action({ action: "actions/setup-go" }), majors([6, "node24"]), [], releases);
  assert.equal(hidden.complete, false);
  assert.deepEqual(hidden.missingMajors, ["6.0.0 (node20)", "6.1.0 (node20)"]);
  const covered = assessAction(action({ action: "actions/setup-go" }), majors([6, "node24"]), rules, releases);
  assert.equal(covered.complete, true);
  assert.equal(versionCovered(rules, "actions/setup-go", "6.0.0"), true);
  assert.equal(versionCovered(rules, "actions/setup-go", "6.1.0"), true);
  assert.equal(versionCovered(rules, "actions/setup-go", "6.2.0"), false);
});

test("releases are recorded only for a major whose runtime changes", () => {
  const recorded = releasesToRecord([
    { version: "5.0.0", using: "node20", file: "action.yml" },
    { version: "5.1.0", using: "node20", file: "action.yml" },
    { version: "6.0.0", using: "node20", file: "action.yml" },
    { version: "6.1.0", using: "node20", file: "action.yml" },
    { version: "6.2.0", using: "node24", file: "action.yml" },
  ]);
  assert.deepEqual(
    recorded.map((release) => release.version),
    ["6.0.0", "6.1.0", "6.2.0"],
  );
});

test("a CodeQL subpath shares the repository PURL identity", () => {
  const rules = [
    baseRule({
      id: "github-actions.codeql-action.node20",
      purl: "pkg:github/github/codeql-action",
      vers: "vers:semver/<4.0.0",
      event: "end-of-support",
    }),
  ];
  assert.equal(majorCovered(rules, "github/codeql-action/init", 3), true);
  assert.equal(majorCovered(rules, "github/codeql-action/analyze", 4), false);
  const scope = parseActionsScope({
    schemaVersion: "ebb.actions-scope.v1",
    reviewedAt: "2026-11-15",
    sources: [{ title: "t", url: "https://example.com/", accessedAt: "2026-11-15" }],
    actions: [{ action: "github/codeql-action/init", repoUrl: "https://github.com/github/codeql-action" }],
  });
  assert.equal(scope.actions[0]?.action, "github/codeql-action/init");
  assert.throws(
    () =>
      parseActionsScope({
        schemaVersion: "ebb.actions-scope.v1",
        reviewedAt: "2026-11-15",
        sources: [{ title: "t", url: "https://example.com/", accessedAt: "2026-11-15" }],
        actions: [{ action: "github/codeql-action/init", repoUrl: "https://github.com/github/codeql-action/init" }],
      }),
    /repoUrl must be https:\/\/github.com\/github\/codeql-action/,
  );
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
  assert.equal(report.actions.length, 43);
  assert.ok(
    report.actions.some((entry) => entry.action === "actions/checkout" && entry.complete && !entry.coverageLimit),
  );
  assert.equal(
    report.actions.some((entry) => entry.action === "github/codeql-action"),
    false,
  );
  for (const subpath of ["init", "autobuild", "analyze", "upload-sarif"]) {
    const entry = report.actions.find((item) => item.action === `github/codeql-action/${subpath}`);
    assert.ok(entry, subpath);
    assert.equal(entry.complete, true, subpath);
    assert.equal(entry.coverageLimit, undefined);
  }
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
