import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { extractPurlAndVersion, parseCheckAllInput, runCli } from "../src/cli.js";
import { VERSION } from "../src/version.js";

const execFileAsync = promisify(execFile);
const cliPath = resolve(process.cwd(), "dist/src/cli.js");

function createMockIo(stdinData?: string) {
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

  async function* stdinGen() {
    if (stdinData !== undefined) {
      yield Buffer.from(stdinData, "utf8");
    }
  }

  return {
    io: {
      stdout,
      stderr,
      stdin: stdinGen(),
    },
    get stdout() {
      return stdoutData;
    },
    get stderr() {
      return stderrData;
    },
  };
}

describe("CLI - unit parsing", () => {
  it("extracts purl and version correctly", () => {
    assert.deepEqual(extractPurlAndVersion("pkg:npm/request@2.88.2"), {
      purl: "pkg:npm/request",
      version: "2.88.2",
    });

    assert.deepEqual(extractPurlAndVersion("pkg:npm/request", "2.88.2"), {
      purl: "pkg:npm/request",
      version: "2.88.2",
    });

    assert.deepEqual(extractPurlAndVersion("node", "18.0.0"), {
      purl: "node",
      version: "18.0.0",
    });

    assert.deepEqual(extractPurlAndVersion("node"), {
      purl: "node",
      version: undefined,
    });
  });

  it("parses check-all json array input", () => {
    const raw = JSON.stringify(["pkg:npm/request@2.88.2", "pkg:generic/nodejs@27.0.0"]);
    const items = parseCheckAllInput(raw);
    assert.equal(items.length, 2);
    assert.equal(items[0]?.purl, "pkg:npm/request");
    assert.equal(items[0]?.version, "2.88.2");
  });

  it("parses check-all CycloneDX input", () => {
    const raw = JSON.stringify({
      bomFormat: "CycloneDX",
      components: [{ purl: "pkg:npm/request@2.88.2" }, { purl: "pkg:generic/nodejs", version: "27.0.0" }],
    });
    const items = parseCheckAllInput(raw);
    assert.equal(items.length, 2);
    assert.equal(items[0]?.purl, "pkg:npm/request");
    assert.equal(items[0]?.version, "2.88.2");
    assert.equal(items[1]?.purl, "pkg:generic/nodejs");
    assert.equal(items[1]?.version, "27.0.0");
  });

  it("parses check-all newline-separated input", () => {
    const raw = "# comment\npkg:npm/request@2.88.2\n\npkg:generic/nodejs@27.0.0\n";
    const items = parseCheckAllInput(raw);
    assert.equal(items.length, 2);
    assert.equal(items[0]?.purl, "pkg:npm/request");
    assert.equal(items[0]?.version, "2.88.2");
  });
});

describe("CLI - runCli commands", () => {
  it("prints version on --version", async () => {
    const mock = createMockIo();
    const code = await runCli(["--version"], mock.io);
    assert.equal(code, 0);
    assert.equal(mock.stdout.trim(), `ebb ${VERSION}`);
  });

  it("prints help on --help", async () => {
    const mock = createMockIo();
    const code = await runCli(["--help"], mock.io);
    assert.equal(code, 0);
    assert.match(mock.stdout, /The open almanac of software end-of-life/);
    assert.match(mock.stdout, /Usage:/);
  });

  it("returns 0 for clean package on check", async () => {
    const mock = createMockIo();
    const code = await runCli(["check", "pkg:generic/nodejs@27.0.0", "--as-of", "2026-04-01"], mock.io);
    assert.equal(code, 0);
    assert.match(mock.stdout, /is ok/);
  });

  it("returns 1 for deprecated package on check", async () => {
    const mock = createMockIo();
    const code = await runCli(["check", "pkg:npm/request@2.88.2", "--as-of", "2026-04-01"], mock.io);
    assert.equal(code, 1);
    assert.match(mock.stdout, /deprecated/);
    assert.match(mock.stdout, /Rule:/);
  });

  it("shows confidence level in text, markdown, and json output", async () => {
    // Text
    const mockText = createMockIo();
    await runCli(["check", "pkg:generic/redis", "5.0.0"], mockText.io);
    assert.match(mockText.stdout, /Confidence:\s+tentative/);

    // Markdown
    const mockMd = createMockIo();
    await runCli(["check", "pkg:generic/redis", "5.0.0", "--format", "markdown"], mockMd.io);
    assert.match(mockMd.stdout, /\| Confidence \|/);
    assert.match(mockMd.stdout, /tentative/);

    // JSON
    const mockJson = createMockIo();
    await runCli(["check", "pkg:generic/redis", "5.0.0", "--json"], mockJson.io);
    const parsed = JSON.parse(mockJson.stdout);
    assert.equal(parsed.matches[0]?.confidence, "tentative");
  });

  it("filters weaker findings with --min-confidence", async () => {
    // Redis 5.0 is tentative. With --min-confidence confirmed, it should be filtered out to ok.
    const mockFiltered = createMockIo();
    const code = await runCli(
      ["check", "pkg:generic/redis", "5.0.0", "--min-confidence", "confirmed"],
      mockFiltered.io,
    );
    assert.equal(code, 0);
    assert.match(mockFiltered.stdout, /is ok/);

    // With --min-confidence tentative, it should still be reported
    const mockTentative = createMockIo();
    const codeTentative = await runCli(
      ["check", "pkg:generic/redis", "5.0.0", "--min-confidence", "tentative"],
      mockTentative.io,
    );
    assert.equal(codeTentative, 1);
    assert.match(mockTentative.stdout, /Confidence:\s+tentative/);
  });

  it("rejects invalid --min-confidence with exit code 2", async () => {
    const mock = createMockIo();
    const code = await runCli(["check", "pkg:npm/request@2.88.2", "--min-confidence", "invalid-level"], mock.io);
    assert.equal(code, 2);
    assert.match(mock.stderr, /Invalid min-confidence/);
  });

  it("supports --json output on check", async () => {
    const mock = createMockIo();
    const code = await runCli(["check", "pkg:npm/request@2.88.2", "--json"], mock.io);
    assert.equal(code, 1);
    const parsed = JSON.parse(mock.stdout);
    assert.equal(parsed.status, "deprecated");
    assert.equal(parsed.version, "2.88.2");
  });

  it("supports shorthand command format", async () => {
    const mock = createMockIo();
    const code = await runCli(["pkg:npm/request@2.88.2", "--json"], mock.io);
    assert.equal(code, 1);
    const parsed = JSON.parse(mock.stdout);
    assert.equal(parsed.status, "deprecated");
  });

  it("returns 2 on missing version", async () => {
    const mock = createMockIo();
    const code = await runCli(["check", "pkg:npm/request"], mock.io);
    assert.equal(code, 2);
    assert.match(mock.stderr, /Version is required/);
  });

  it("returns 2 on invalid purl", async () => {
    const mock = createMockIo();
    const code = await runCli(["check", "pkg:invalid/??", "1.0.0"], mock.io);
    assert.equal(code, 2);
    assert.match(mock.stderr, /Error:/);
  });

  it("returns 2 on unknown command", async () => {
    const mock = createMockIo();
    const code = await runCli(["unknown-cmd"], mock.io);
    assert.equal(code, 2);
    assert.match(mock.stderr, /Unknown command/);
  });

  it("runs check-all over stdin", async () => {
    const input = JSON.stringify(["pkg:npm/request@2.88.2", "pkg:generic/nodejs@27.0.0"]);
    const mock = createMockIo(input);
    const code = await runCli(["check-all", "-", "--json", "--as-of", "2026-04-01"], mock.io);
    assert.equal(code, 1); // has 1 deprecated package
    const parsed = JSON.parse(mock.stdout);
    assert.equal(parsed.results.length, 2);
    assert.equal(parsed.summary.total, 2);
    assert.equal(parsed.summary.byStatus.deprecated, 1);
    assert.equal(parsed.summary.byStatus.ok, 1);
  });

  it("runs replacement command", async () => {
    const mock = createMockIo();
    const code = await runCli(["replacement", "pkg:npm/request@2.88.2"], mock.io);
    assert.equal(code, 0);
    assert.match(mock.stdout, /Native fetch or a maintained HTTP client/);
  });

  it("runs replacement command with --json", async () => {
    const mock = createMockIo();
    const code = await runCli(["replacement", "pkg:npm/request@2.88.2", "--json"], mock.io);
    assert.equal(code, 0);
    const parsed = JSON.parse(mock.stdout);
    assert.match(parsed.replacement, /fetch/);
    assert.ok(Array.isArray(parsed.replacements));
  });

  it("runs replacement command showing structured replacements in text and json", async () => {
    const mockText = createMockIo();
    const codeText = await runCli(["replacement", "pkg:npm/node-sass@9.0.0"], mockText.io);
    assert.equal(codeText, 0);
    assert.match(mockText.stdout, /sass/);
    assert.match(mockText.stdout, /pkg:npm\/sass/);

    const mockJson = createMockIo();
    const codeJson = await runCli(["replacement", "pkg:npm/node-sass@9.0.0", "--json"], mockJson.io);
    assert.equal(codeJson, 0);
    const parsed = JSON.parse(mockJson.stdout);
    assert.equal(parsed.replacement, "pkg:npm/sass");
    assert.equal(parsed.replacements.length, 1);
    assert.equal(parsed.replacements[0].purl, "pkg:npm/sass");
    assert.equal(parsed.replacements[0].kind, "successor");
  });

  it("returns 1 for replacement when none exists", async () => {
    const mock = createMockIo();
    const code = await runCli(["replacement", "pkg:generic/nodejs@27.0.0"], mock.io);
    assert.equal(code, 1);
    assert.match(mock.stdout, /No suggested replacement/);
  });

  it("runs rules command", async () => {
    const mock = createMockIo();
    const code = await runCli(["rules", "pkg:npm/request"], mock.io);
    assert.equal(code, 0);
    assert.match(mock.stdout, /npm\.package\.request\.deprecated/);
  });

  it("runs stale with a fixed as-of day", async () => {
    const mock = createMockIo();
    const code = await runCli(["stale", "--as-of", "2026-11-14", "--json"], mock.io);
    assert.equal(code, 0);
    const parsed = JSON.parse(mock.stdout);
    assert.equal(parsed.schemaVersion, "ebb.stale.v1");
    assert.equal(parsed.asOf, "2026-11-14");
    assert.equal(parsed.counts.stale, 0);
    assert.ok(parsed.counts.total > 0);
  });

  it("exits 1 from stale when older-than finds overdue rules", async () => {
    const mock = createMockIo();
    const code = await runCli(["stale", "--as-of", "2026-11-14", "--older-than", "1d", "--json"], mock.io);
    assert.equal(code, 1);
    const parsed = JSON.parse(mock.stdout);
    assert.ok(parsed.counts.stale > 0);
  });

  it("runs diff command with text, markdown, and json formats", async () => {
    // 1. Text format
    const mockText = createMockIo();
    const codeText = await runCli(["diff", "bundled", "active"], mockText.io);
    assert.equal(codeText, 0);
    assert.match(mockText.stdout, /ebb diff:/);

    // 2. Markdown format
    const mockMd = createMockIo();
    const codeMd = await runCli(["diff", "bundled", "active", "--format", "markdown"], mockMd.io);
    assert.equal(codeMd, 0);
    assert.match(mockMd.stdout, /# Ebb Lifecycle Data Diff/);

    // 3. JSON format
    const mockJson = createMockIo();
    const codeJson = await runCli(["diff", "bundled", "active", "--json"], mockJson.io);
    assert.equal(codeJson, 0);
    const parsed = JSON.parse(mockJson.stdout);
    assert.equal(parsed.schemaVersion, "ebb.data-diff.v1");
    assert.ok(parsed.summary);
  });

  it("runs update command with --rollback on bundled data and exits with error code 1", async () => {
    const mock = createMockIo();
    const code = await runCli(["update", "--rollback"], mock.io);
    assert.equal(code, 1);
    assert.match(mock.stderr, /Cannot roll back/);
  });

  it("runs data-status command with text, markdown, and json formats", async () => {
    // 1. Text format
    const mockText = createMockIo();
    const codeText = await runCli(["data-status", "--as-of", "2026-11-18"], mockText.io);
    assert.equal(codeText, 0);
    assert.match(mockText.stdout, /Lifecycle data status:/);
    assert.match(mockText.stdout, /Source:\s+bundled/);

    // 2. Markdown format
    const mockMd = createMockIo();
    const codeMd = await runCli(["data-status", "--as-of", "2026-11-18", "--format", "markdown"], mockMd.io);
    assert.equal(codeMd, 0);
    assert.match(mockMd.stdout, /### Ebb Lifecycle Data Status/);

    // 3. JSON format
    const mockJson = createMockIo();
    const codeJson = await runCli(["data-status", "--as-of", "2026-11-18", "--json"], mockJson.io);
    assert.equal(codeJson, 0);
    const parsed = JSON.parse(mockJson.stdout);
    assert.equal(parsed.schemaVersion, "ebb.data-status.v1");
    assert.equal(parsed.source, "bundled");
    assert.equal(parsed.stale, false);
  });

  it("exits 1 from data-status when max-age threshold is exceeded", async () => {
    const mock = createMockIo();
    const code = await runCli(["data-status", "--as-of", "2026-11-18", "--max-age", "0", "--json"], mock.io);
    assert.equal(code, 1);
    const parsed = JSON.parse(mock.stdout);
    assert.equal(parsed.stale, true);
    assert.ok(parsed.warnings.length > 0);
  });
});

describe("CLI versions", () => {
  it("prints text, markdown, and json for a runtime", async () => {
    const text = createMockIo();
    assert.equal(await runCli(["versions", "node", "--as-of", "2026-11-15"], text.io), 0);
    assert.match(text.stdout, /26\.x/);
    assert.match(text.stdout, /recommended/);
    assert.doesNotMatch(text.stdout, /\u001b/);

    const markdown = createMockIo();
    assert.equal(await runCli(["versions", "node", "--as-of", "2026-11-15", "--format", "markdown"], markdown.io), 0);
    assert.match(markdown.stdout, /\| 26\.x \|/);
    assert.match(markdown.stdout, /recommended/);

    const json = createMockIo();
    assert.equal(await runCli(["versions", "pkg:npm/request", "--as-of", "2026-11-15", "--json"], json.io), 0);
    const parsed = JSON.parse(json.stdout) as { recommendation: null; lines: Array<{ id: string }> };
    assert.equal(parsed.recommendation, null);
    assert.equal(parsed.lines[0]?.id, "*");
  });

  it("prints an empty answer for an unknown component", async () => {
    const mock = createMockIo();
    const code = await runCli(
      ["versions", "pkg:npm/not-a-real-ebb-package", "--as-of", "2026-11-15", "--json"],
      mock.io,
    );
    assert.equal(code, 0);
    const parsed = JSON.parse(mock.stdout) as { lines: unknown[]; complete: boolean };
    assert.deepEqual(parsed.lines, []);
    assert.equal(parsed.complete, false);
  });

  it("rejects a bad reference date", async () => {
    const mock = createMockIo();
    const code = await runCli(["versions", "node", "--as-of", "yesterday"], mock.io);
    assert.equal(code, 2);
    assert.match(mock.stderr, /not a date/);
  });
});

describe("CLI docs coverage (cli-time-1)", () => {
  it("ensures every command in the help text has a section in docs/cli.md", async () => {
    const mock = createMockIo();
    await runCli(["--help"], mock.io);
    const docs = readFileSync(resolve(process.cwd(), "docs/cli.md"), "utf8");

    const usageMatch = /Usage:\s*([\s\S]*?)\n\nOptions:/i.exec(mock.stdout);
    assert.ok(usageMatch, "Usage section found in help text");
    const commandLines = usageMatch[1]!
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("ebb "));

    for (const cmdLine of commandLines) {
      const parts = cmdLine.split(/\s+/);
      const cmdName = parts[1];
      assert.ok(cmdName, `Valid command name from ${cmdLine}`);
      const hasSection =
        docs.includes(`### \`ebb ${cmdName}\``) ||
        docs.includes(`### \`ebb ${cmdName} `) ||
        docs.includes(`### \`ebb ${cmdName}<`);
      assert.ok(hasSection, `docs/cli.md has section for command "ebb ${cmdName}"`);
    }
  });
});

describe("CLI check-all with --as-of (cli-time-6)", () => {
  it("gives different results for the same input on two dates and prints reference date in header", async () => {
    const input = JSON.stringify(["pkg:docker/library/node@22.0.0"]);

    // Date 1: 2026-01-01 (484 days left)
    const mock1 = createMockIo(input);
    const code1 = await runCli(["check-all", "-", "--as-of", "2026-01-01", "--format", "markdown"], mock1.io);
    assert.equal(code1, 0);
    assert.ok(mock1.stdout.includes("### Ebb Lifecycle Check Summary (as of 2026-01-01)"));
    assert.ok(mock1.stdout.includes("484 days"));

    // Date 2: 2027-01-01 (119 days left)
    const mock2 = createMockIo(input);
    const code2 = await runCli(["check-all", "-", "--as-of", "2027-01-01", "--format", "markdown"], mock2.io);
    assert.equal(code2, 0);
    assert.ok(mock2.stdout.includes("### Ebb Lifecycle Check Summary (as of 2027-01-01)"));
    assert.ok(mock2.stdout.includes("119 days"));

    assert.notEqual(mock1.stdout, mock2.stdout);

    // Absent --as-of: header does not contain "(as of"
    const mock3 = createMockIo(input);
    await runCli(["check-all", "-", "--format", "markdown"], mock3.io);
    assert.ok(mock3.stdout.includes("### Ebb Lifecycle Check Summary\n"));
    assert.equal(mock3.stdout.includes("(as of"), false);
  });
});

describe("CLI upcoming --format ical (cli-time-7)", () => {
  it("outputs a valid iCalendar with expected events", async () => {
    const mock = createMockIo();
    const code = await runCli(["upcoming", "--as-of", "2026-04-01", "--within", "90d", "--format", "ical"], mock.io);
    assert.equal(code, 0);
    const out = mock.stdout;
    assert.ok(out.includes("BEGIN:VCALENDAR"));
    assert.ok(out.includes("VERSION:2.0"));
    assert.ok(out.includes("PRODID:-//Velella//Ebb//EN"));
    assert.ok(out.includes("BEGIN:VEVENT"));
    assert.ok(out.includes("END:VEVENT"));
    assert.ok(out.includes("END:VCALENDAR"));
  });
});

describe("CLI upcoming exit codes with --fail-within (cli-time-8)", () => {
  it("exits 0 when no events fall within --fail-within", async () => {
    const mock = createMockIo();
    const code = await runCli(
      ["upcoming", "--as-of", "2026-04-01", "--purl", "pkg:generic/erlang", "--fail-within", "10d"],
      mock.io,
    );
    assert.equal(code, 0);
  });

  it("exits 1 when a deadline falls within --fail-within", async () => {
    const mock = createMockIo();
    const code = await runCli(
      ["upcoming", "--as-of", "2026-04-01", "--purl", "pkg:generic/erlang", "--fail-within", "50d"],
      mock.io,
    );
    assert.equal(code, 1);
  });

  it("exits 2 on invalid --fail-within window argument", async () => {
    const mock = createMockIo();
    const code = await runCli(["upcoming", "--fail-within", "invalid-syntax"], mock.io);
    assert.equal(code, 2);
    assert.match(mock.stderr, /Error:/);
  });
});

describe("CLI upcoming --countdown (cli-time-4)", () => {
  it("runs upcoming --countdown in non-TTY mode with plain text bars", async () => {
    const mock = createMockIo();
    const code = await runCli(["upcoming", "--as-of", "2026-04-01", "--within", "90d", "--countdown"], mock.io);
    assert.equal(code, 0);
    assert.match(mock.stdout, /Lifecycle countdown as of 2026-04-01/);
    assert.doesNotMatch(mock.stdout, /\u001b\[/);
  });

  it("runs upcoming --countdown --json", async () => {
    const mock = createMockIo();
    const code = await runCli(
      ["upcoming", "--as-of", "2026-04-01", "--within", "90d", "--countdown", "--json"],
      mock.io,
    );
    assert.equal(code, 0);
    const parsed = JSON.parse(mock.stdout) as { schemaVersion: string; rows: unknown[] };
    assert.equal(parsed.schemaVersion, "ebb.countdown.v1");
    assert.ok(Array.isArray(parsed.rows));
  });
});

describe("CLI - end-to-end binary execution", () => {
  it("executes CLI process via node", async () => {
    try {
      await execFileAsync("node", [cliPath, "check", "pkg:npm/request@2.88.2", "--json"]);
      assert.fail("Should have exited with code 1");
    } catch (err: unknown) {
      const execErr = err as { code: number; stdout: string };
      assert.equal(execErr.code, 1);
      const parsed = JSON.parse(execErr.stdout);
      assert.equal(parsed.status, "deprecated");
    }
  });

  it("executes CLI --version via node", async () => {
    const { stdout } = await execFileAsync("node", [cliPath, "--version"]);
    assert.equal(stdout.trim(), `ebb ${VERSION}`);
  });
});
