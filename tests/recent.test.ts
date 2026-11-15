import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recent, computeSinceDate } from "../src/recent.js";
import { runCli } from "../src/cli.js";
import type { RegistryV2Rule } from "../src/registry.js";

function createMockRule(partial: Partial<RegistryV2Rule> & { id: string; deadline: string }): RegistryV2Rule {
  return {
    id: partial.id,
    ecosystem: partial.ecosystem ?? "npm",
    purl: partial.purl ?? `pkg:npm/${partial.id}`,
    vers: partial.vers ?? "vers:npm/*",
    event: partial.event ?? "end-of-life",
    title: partial.title ?? `Lifecycle event for ${partial.id}`,
    summary: partial.summary ?? `Summary for ${partial.id}`,
    severity: partial.severity ?? "high",
    deadline: partial.deadline,
    sources: partial.sources ?? [{ title: "Source", url: "https://example.com" }],
    provenance: partial.provenance ?? {
      observedAt: "2026-01-01",
      reviewedAt: "2026-01-01",
      reviewer: "test",
      method: "manual",
    },
    ...(partial.replacement ? { replacement: partial.replacement } : {}),
  };
}

function createMockIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: {
        write(str: string) {
          stdout += str;
          return true;
        },
      },
      stderr: {
        write(str: string) {
          stderr += str;
          return true;
        },
      },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

describe("recent: window and calculation", () => {
  const asOf = "2026-11-15";

  it("computes since date correctly for days and months", () => {
    const { span: span30, since: since30 } = computeSinceDate("30d", asOf);
    assert.equal(span30, "30d");
    assert.equal(since30, "2026-10-16");

    const { span: span1m, since: since1m } = computeSinceDate("1m", asOf);
    assert.equal(span1m, "1m");
    assert.equal(since1m, "2026-10-15");
  });

  it("returns empty items when no events fell in window", () => {
    const mockRules: RegistryV2Rule[] = [
      createMockRule({ id: "rule-future", deadline: "2026-12-01" }),
      createMockRule({ id: "rule-way-past", deadline: "2025-01-01" }),
    ];
    const res = recent({ asOf, within: "30d", rules: mockRules });
    assert.equal(res.asOf, asOf);
    assert.equal(res.count, 0);
    assert.deepEqual(res.items, []);
  });

  it("identifies one event and computes daysAgo accurately", () => {
    const mockRules: RegistryV2Rule[] = [
      createMockRule({
        id: "rule-recent-1",
        deadline: "2026-11-10",
        severity: "critical",
        purl: "pkg:npm/test-pkg",
        title: "Test Pkg EOL",
      }),
    ];
    const res = recent({ asOf, within: "30d", rules: mockRules });
    assert.equal(res.count, 1);
    const item = res.items[0]!;
    assert.equal(item.ruleId, "rule-recent-1");
    assert.equal(item.deadline, "2026-11-10");
    assert.equal(item.daysAgo, 5);
    assert.equal(item.severity, "critical");
  });

  it("sorts multiple events by date descending (most recent first), then severity, then ruleId", () => {
    const mockRules: RegistryV2Rule[] = [
      createMockRule({ id: "rule-oldest", deadline: "2026-10-20", severity: "high" }),
      createMockRule({ id: "rule-newest-low", deadline: "2026-11-14", severity: "low" }),
      createMockRule({ id: "rule-newest-high", deadline: "2026-11-14", severity: "critical" }),
      createMockRule({ id: "rule-middle", deadline: "2026-11-01", severity: "medium" }),
    ];
    const res = recent({ asOf, within: "30d", rules: mockRules });
    assert.equal(res.count, 4);
    assert.deepEqual(
      res.items.map((i) => i.ruleId),
      ["rule-newest-high", "rule-newest-low", "rule-middle", "rule-oldest"],
    );
  });
});

describe("recent: CLI execution", () => {
  it("runs ebb recent with fixed as-of and returns valid text and json", async () => {
    const mockText = createMockIo();
    const codeText = await runCli(["recent", "--as-of", "2026-11-15", "--within", "90d"], mockText.io);
    assert.equal(codeText, 0);
    assert.match(mockText.stdout, /Recent deadlines within 90d/);

    const mockJson = createMockIo();
    const codeJson = await runCli(["recent", "--as-of", "2026-11-15", "--within", "90d", "--json"], mockJson.io);
    assert.equal(codeJson, 0);
    const parsed = JSON.parse(mockJson.stdout) as { asOf: string; count: number; items: unknown[] };
    assert.equal(parsed.asOf, "2026-11-15");
    assert.ok(typeof parsed.count === "number");
  });
});
