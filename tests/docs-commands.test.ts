import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";

const repoRoot = resolve(process.cwd());
const cliBin = resolve(repoRoot, "dist/src/cli.js");

function getMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
      results.push(...getMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

interface CommandEntry {
  file: string;
  command: string;
  args: string[];
}

export function extractDocsCommands(): CommandEntry[] {
  const files = [resolve(repoRoot, "README.md"), ...getMarkdownFiles(resolve(repoRoot, "docs"))];
  const commands: CommandEntry[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const codeBlocks = content.matchAll(/```(?:bash|sh|shell|terminal)?\n([\s\S]*?)```/g);
    for (const block of codeBlocks) {
      const blockContent = block[1];
      if (!blockContent) continue;
      const lines = blockContent.split("\n");
      for (let rawLine of lines) {
        let line = rawLine.trim();
        if (line.startsWith("$ ")) line = line.slice(2).trim();
        if (
          !line.startsWith("ebb ") &&
          !line.startsWith("npx @velella/ebb ") &&
          !line.startsWith("npx -y @velella/ebb ")
        ) {
          continue;
        }

        // Remove shell output redirections like `> upcoming.ics`
        if (line.includes(" > ")) {
          line = line.split(" > ")[0]!.trim();
        }

        // Parse CLI arguments
        let cmdParts: string[];
        if (line.startsWith("npx -y @velella/ebb ")) {
          cmdParts = line.slice("npx -y @velella/ebb ".length).trim().split(/\s+/);
        } else if (line.startsWith("npx @velella/ebb ")) {
          cmdParts = line.slice("npx @velella/ebb ".length).trim().split(/\s+/);
        } else {
          cmdParts = line.slice("ebb ".length).trim().split(/\s+/);
        }

        // Skip placeholder commands (e.g. containing <agent>, <purl>, or ellipsis)
        if (cmdParts.some((p) => p.includes("<") || p.includes(">") || p === "...")) {
          continue;
        }

        // Skip standalone daemon/stdio server command without flags
        if (cmdParts.length === 1 && cmdParts[0] === "mcp") {
          continue;
        }

        // Skip commands that explicitly trigger network requests
        if (
          cmdParts.includes("--fetch") ||
          (cmdParts[0] === "update" && !cmdParts.includes("--offline") && !cmdParts.includes("--from"))
        ) {
          continue;
        }

        if (seen.has(line)) continue;
        seen.add(line);

        commands.push({
          file: resolve(file),
          command: line,
          args: cmdParts,
        });
      }
    }
  }

  return commands;
}

describe("Documentation Commands Suite (Issue #574)", () => {
  let tempCwd: string;

  before(() => {
    tempCwd = join(tmpdir(), `ebb-docs-test-${Date.now()}`);
    mkdirSync(tempCwd, { recursive: true });

    // Provide sample bom.json for check-all examples
    const sampleBom = resolve(repoRoot, "examples/cyclonedx/bom.json");
    if (existsSync(sampleBom)) {
      copyFileSync(sampleBom, join(tempCwd, "bom.json"));
    }

    // Provide dummy bundle files in temp cwd so file checks don't fail unexpectedly
    const sampleBundle = resolve(repoRoot, "dist/data/bundle.json");
    if (existsSync(sampleBundle)) {
      mkdirSync(join(tempCwd, "dist/data"), { recursive: true });
      copyFileSync(sampleBundle, join(tempCwd, "dist/data/bundle.json"));
      copyFileSync(sampleBundle, join(tempCwd, "bundle.json"));
    }
  });

  after(() => {
    if (existsSync(tempCwd)) {
      rmSync(tempCwd, { recursive: true, force: true });
    }
  });

  const commands = extractDocsCommands();

  it("extracts executable CLI commands from README and docs", () => {
    assert.ok(commands.length >= 10, `Expected at least 10 commands, got ${commands.length}`);
  });

  for (const { file, command, args } of commands) {
    it(`validates CLI usage for: "${command}" (from ${file.replace(repoRoot + "/", "")})`, () => {
      const result = spawnSync(process.execPath, [cliBin, ...args], {
        cwd: tempCwd,
        encoding: "utf-8",
        env: {
          ...process.env,
          NO_COLOR: "1",
          EBB_FIXED_DATE: "2026-11-15",
        },
      });

      const stderr = result.stderr ?? "";
      const stdout = result.stdout ?? "";

      // Check for CLI usage syntax errors (unknown option, unsupported agent, invalid flag)
      const isUsageError =
        stderr.includes("Unknown option") ||
        stderr.includes("Unsupported agent") ||
        stderr.includes("Unknown command") ||
        stderr.includes("To specify a positional argument") ||
        stderr.includes("Usage: ebb") ||
        stdout.includes("Usage: ebb");

      assert.equal(
        isUsageError,
        false,
        `Command produced a usage/syntax error:\nCommand: ${command}\nStderr: ${stderr}\nStdout: ${stdout}`,
      );
    });
  }
});
