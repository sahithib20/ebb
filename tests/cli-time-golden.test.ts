import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { GOLDEN_COMMANDS, runCommandCapture } from "../tools/refresh-cli-time-golden.js";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/cli-time");

describe("CLI time commands golden tests (cli-time-10)", () => {
  for (const cmd of GOLDEN_COMMANDS) {
    it(`locks output for ${cmd.name} against ${cmd.outputFile}`, async () => {
      const actual = await runCommandCapture(cmd.args);
      const expected = readFileSync(resolve(fixturesDir, cmd.outputFile), "utf8");

      if (cmd.outputFile.endsWith(".json")) {
        assert.deepEqual(JSON.parse(actual), JSON.parse(expected));
      }
      assert.equal(actual, expected);
    });
  }

  it("checks README examples against the same runs", async () => {
    const readmeContent = readFileSync(resolve(process.cwd(), "README.md"), "utf8");

    // README includes: npx @velella/ebb as-of 2027-05-01 node 22.11.0
    assert.ok(
      readmeContent.includes("as-of 2027-05-01 node 22.11.0"),
      "README contains as-of 2027-05-01 node 22.11.0 example",
    );
    const asOfRun = await runCommandCapture(["as-of", "2027-05-01", "node", "22.11.0", "--no-color"]);
    const asOfFixture = readFileSync(resolve(fixturesDir, "as-of.txt"), "utf8");
    assert.equal(asOfRun, asOfFixture);

    // README includes: npx @velella/ebb upcoming --within 90d --ecosystem nodejs
    assert.ok(
      readmeContent.includes("upcoming --within 90d --ecosystem nodejs"),
      "README contains upcoming --within 90d --ecosystem nodejs example",
    );
    const upcomingRun = await runCommandCapture([
      "upcoming",
      "--as-of",
      "2026-04-01",
      "--within",
      "90d",
      "--ecosystem",
      "nodejs",
      "--no-color",
    ]);
    const upcomingFixture = readFileSync(resolve(fixturesDir, "upcoming.txt"), "utf8");
    assert.equal(upcomingRun, upcomingFixture);
  });

  it("passes identically on two different dates without reading system clock", async () => {
    const origNow = Date.now;
    try {
      // Simulate Day 1: 2020-01-01
      Date.now = () => new Date("2020-01-01T12:00:00Z").getTime();
      for (const cmd of GOLDEN_COMMANDS) {
        const outDay1 = await runCommandCapture(cmd.args);
        const expected = readFileSync(resolve(fixturesDir, cmd.outputFile), "utf8");
        assert.equal(outDay1, expected, `${cmd.name} on simulated 2020-01-01 matches golden fixture`);
      }

      // Simulate Day 2: 2035-12-31
      Date.now = () => new Date("2035-12-31T12:00:00Z").getTime();
      for (const cmd of GOLDEN_COMMANDS) {
        const outDay2 = await runCommandCapture(cmd.args);
        const expected = readFileSync(resolve(fixturesDir, cmd.outputFile), "utf8");
        assert.equal(outDay2, expected, `${cmd.name} on simulated 2035-12-31 matches golden fixture`);
      }
    } finally {
      Date.now = origNow;
    }
  });
});
