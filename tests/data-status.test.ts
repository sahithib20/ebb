import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runCli } from "../src/cli.js";
import { dataStatus } from "../src/data-status.js";

function createMockIo() {
  let stdoutData = "";
  let stderrData = "";

  const stdout = {
    write(str: string) {
      stdoutData += str;
      return true;
    },
  };

  const stderr = {
    write(str: string) {
      stderrData += str;
      return true;
    },
  };

  return {
    io: { stdout, stderr },
    get stdout() {
      return stdoutData;
    },
    get stderr() {
      return stderrData;
    },
  };
}

describe("offline-8: warn when active data is old", () => {
  it("dataStatus includes warning when active data is older than stale limit", () => {
    // Bundled reviewedThrough is 2026-11-15.
    // 50 days later: 2027-01-04
    const statusFresh = dataStatus({ now: "2026-11-20T00:00:00Z" });
    assert.equal(statusFresh.stale, false);
    assert.equal(
      statusFresh.warnings.some((w) => w.includes("freshness threshold")),
      false,
    );

    const statusOld = dataStatus({ now: "2027-01-15T00:00:00Z" });
    assert.equal(statusOld.stale, true);
    assert.ok(statusOld.warnings.some((w) => w.includes("freshness threshold")));
  });

  it("CLI prints no warning on stderr when data is fresh", async () => {
    const prevAge = process.env.EBB_DATA_MAX_AGE_DAYS;
    try {
      // Set high freshness window to ensure data is considered fresh
      process.env.EBB_DATA_MAX_AGE_DAYS = "99999";
      const mock = createMockIo();
      const code = await runCli(["check", "pkg:npm/express@4.18.2"], mock.io);
      assert.equal(code, 0);
      assert.equal(mock.stderr, "");
      assert.ok(mock.stdout.includes("pkg:npm/express@4.18.2"));
    } finally {
      if (prevAge === undefined) delete process.env.EBB_DATA_MAX_AGE_DAYS;
      else process.env.EBB_DATA_MAX_AGE_DAYS = prevAge;
    }
  });

  it("CLI prints warning on stderr once when data is old, keeping stdout and exit code unchanged", async () => {
    const prevAge = process.env.EBB_DATA_MAX_AGE_DAYS;
    try {
      // Set 0 days max age to force stale status
      process.env.EBB_DATA_MAX_AGE_DAYS = "0";

      // 1. Passing check with old data
      const mock1 = createMockIo();
      const code1 = await runCli(["check", "pkg:npm/express@4.18.2", "--json"], mock1.io);
      assert.equal(code1, 0, "must not block or fail check because data is old");
      assert.match(mock1.stderr, /Warning: Data is \d+ days old/);
      assert.match(mock1.stderr, /Run 'ebb update' to refresh/);
      const parsed1 = JSON.parse(mock1.stdout);
      assert.equal(parsed1.status, "ok");

      // 2. Deprecated package check with old data
      const mock2 = createMockIo();
      const code2 = await runCli(["check", "pkg:npm/request@2.88.2", "--json"], mock2.io);
      assert.equal(code2, 1, "exit code must reflect check verdict, not data age");
      assert.match(mock2.stderr, /Warning: Data is \d+ days old/);
      const parsed2 = JSON.parse(mock2.stdout);
      assert.equal(parsed2.status, "deprecated");
    } finally {
      if (prevAge === undefined) delete process.env.EBB_DATA_MAX_AGE_DAYS;
      else process.env.EBB_DATA_MAX_AGE_DAYS = prevAge;
    }
  });

  it("CLI silences warning on stderr when --quiet (-q) is passed", async () => {
    const prevAge = process.env.EBB_DATA_MAX_AGE_DAYS;
    try {
      process.env.EBB_DATA_MAX_AGE_DAYS = "0";

      // Test with --quiet
      const mock1 = createMockIo();
      const code1 = await runCli(["check", "pkg:npm/express@4.18.2", "--quiet", "--json"], mock1.io);
      assert.equal(code1, 0);
      assert.equal(mock1.stderr, "");
      const parsed1 = JSON.parse(mock1.stdout);
      assert.equal(parsed1.status, "ok");

      // Test with -q
      const mock2 = createMockIo();
      const code2 = await runCli(["check", "pkg:npm/express@4.18.2", "-q", "--json"], mock2.io);
      assert.equal(code2, 0);
      assert.equal(mock2.stderr, "");
      const parsed2 = JSON.parse(mock2.stdout);
      assert.equal(parsed2.status, "ok");
    } finally {
      if (prevAge === undefined) delete process.env.EBB_DATA_MAX_AGE_DAYS;
      else process.env.EBB_DATA_MAX_AGE_DAYS = prevAge;
    }
  });
});
