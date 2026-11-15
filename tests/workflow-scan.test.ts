import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

interface Finding {
  action: string;
  ref: string;
  purl: string;
  rule: string | null;
  status: string;
}

const map = JSON.parse(await readFile("registry/github-actions-shas.json", "utf8")) as {
  actions: Record<string, Record<string, string>>;
};

function pin(action: string, prefix: string): { sha: string; tag: string } {
  const hit = Object.entries(map.actions[action] ?? {}).find(([, tag]) => tag.startsWith(prefix));
  assert.ok(hit, `${action} is missing a ${prefix} pin`);
  return { sha: hit[0]!, tag: hit[1]! };
}

test("a workflow scan resolves tags, major tags, and SHA pins to rule ids", async () => {
  const ai = pin("actions/ai-inference", "v1.");
  const codeql = pin("github/codeql-action", "v3.");
  const upload = pin("actions/upload-artifact", "v6.");
  const steps = [
    `actions/ai-inference@v1`,
    `actions/ai-inference@${ai.tag}`,
    `actions/ai-inference@${ai.sha}`,
    `actions/ai-inference@v2`,
    `actions/attest@v2`,
    `actions/attest@v3`,
    `actions/delete-package-versions@v1`,
    `actions/delete-package-versions@v5`,
    `actions/dependency-review-action@v4`,
    `actions/dependency-review-action@v5`,
    `actions/go-dependency-submission@v1`,
    `actions/go-dependency-submission@v2`,
    `github/codeql-action/init@v3`,
    `github/codeql-action/init@${codeql.sha}`,
    `github/codeql-action/analyze@v4`,
    `actions/upload-artifact@v3`,
    `actions/upload-artifact@v5`,
    `actions/upload-artifact@v6`,
    `actions/upload-artifact@${upload.sha}`,
    `actions/download-artifact@v3`,
    `actions/download-artifact@v6`,
    `actions/download-artifact@v7`,
    `actions/cache@v2`,
    `actions/cache@v4`,
    `actions/cache@v5`,
  ];
  const workflow = [
    "name: fixture",
    "on: push",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    ...steps.map((uses) => `      - uses: ${uses}`),
    "",
  ].join("\n");
  const root = await mkdtemp(join(tmpdir(), "ebb-workflow-"));
  const workflowPath = join(root, "workflow.yml");
  const outPath = join(root, "findings.json");
  try {
    await writeFile(workflowPath, workflow);
    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        `import { writeFileSync } from "node:fs";
         import { evaluateWorkflow } from "./examples/github-actions/check-workflow.ts";
         const report = evaluateWorkflow(process.argv[1]);
         writeFileSync(process.argv[2], JSON.stringify(report.results.map((item) => ({
           action: item.action, ref: item.ref, purl: item.purl, rule: item.rule ?? null, status: item.status,
         }))));`,
        workflowPath,
        outPath,
      ],
      { cwd: process.cwd() },
    );
    const findings = JSON.parse(await readFile(outPath, "utf8")) as Finding[];
    const byRef = new Map(findings.map((item) => [`${item.action}@${item.ref}`, item]));
    const expectRule = (uses: string, rule: string | null) => {
      const item = byRef.get(uses);
      assert.ok(item, uses);
      assert.equal(item.rule, rule, uses);
      const removed = rule?.endsWith(".retired") || rule?.endsWith(".service-v1-v2");
      assert.equal(item.status, rule ? (removed ? "removed" : "unsupported") : "ok", uses);
    };
    expectRule("actions/ai-inference@v1", "github-actions.ai-inference.node20");
    expectRule(`actions/ai-inference@${ai.tag}`, "github-actions.ai-inference.node20");
    expectRule(`actions/ai-inference@${ai.sha}`, "github-actions.ai-inference.node20");
    expectRule("actions/ai-inference@v2", null);
    expectRule("actions/attest@v2", "github-actions.attest.node20");
    expectRule("actions/attest@v3", null);
    expectRule("actions/delete-package-versions@v1", "github-actions.delete-package-versions.node12");
    expectRule("actions/delete-package-versions@v5", "github-actions.delete-package-versions.node20");
    expectRule("actions/dependency-review-action@v4", "github-actions.dependency-review-action.node20");
    expectRule("actions/dependency-review-action@v5", null);
    expectRule("actions/go-dependency-submission@v1", "github-actions.go-dependency-submission.node16");
    expectRule("actions/go-dependency-submission@v2", "github-actions.go-dependency-submission.node20");
    expectRule("github/codeql-action/init@v3", "github-actions.codeql-action.node20");
    expectRule(`github/codeql-action/init@${codeql.sha}`, "github-actions.codeql-action.node20");
    expectRule("github/codeql-action/analyze@v4", null);
    expectRule("actions/upload-artifact@v3", "github-actions.upload-artifact.retired");
    expectRule("actions/upload-artifact@v5", "github-actions.upload-artifact.node20");
    expectRule("actions/upload-artifact@v6", null);
    expectRule(`actions/upload-artifact@${upload.sha}`, null);
    expectRule("actions/download-artifact@v3", "github-actions.download-artifact.retired");
    expectRule("actions/download-artifact@v6", "github-actions.download-artifact.node20");
    expectRule("actions/download-artifact@v7", null);
    expectRule("actions/cache@v2", "github-actions.cache.service-v1-v2");
    expectRule("actions/cache@v4", "github-actions.cache.node20");
    expectRule("actions/cache@v5", null);
    assert.equal(byRef.get("github/codeql-action/init@v3")?.purl, "pkg:github/github/codeql-action#init");
    assert.equal(byRef.get("github/codeql-action/analyze@v4")?.purl, "pkg:github/github/codeql-action#analyze");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
