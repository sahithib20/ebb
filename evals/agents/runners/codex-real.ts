import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunner, RunnerMode, RunnerRunResult } from "../runner.js";
import { readDirectoryFiles } from "../runner.js";
import type { EvalTask } from "../score.js";
import { redactKeys } from "./claude-code-real.js";
import { formatCodexPrompt } from "./codex.js";

/**
 * Checks whether the Codex CLI and required API key are available in the current environment.
 */
export function isCodexAvailable(): boolean {
  if (!process.env.OPENAI_API_KEY && !process.env.CODEX_API_KEY) return false;
  try {
    const probe = spawnSync("codex", ["--version"], { stdio: "ignore" });
    return probe.status === 0;
  } catch {
    return false;
  }
}

/**
 * Real Codex / Cursor runner executing tasks via CLI.
 * Supports baseline and mcp modes.
 */
export function createRealCodexRunner(): AgentRunner {
  return {
    name: "Codex / Cursor",
    kind: "real",
    model: process.env.OPENAI_MODEL || "gpt-4o",
    agentVersion: "codex-latest",
    isAvailable: isCodexAvailable,
    run(task: EvalTask, mode: RunnerMode, workDir: string): RunnerRunResult {
      if (!isCodexAvailable()) {
        const msg = "[agent-evals] Codex CLI or OPENAI_API_KEY missing; skipping real Codex run.";
        console.warn(msg);
        return {
          taskId: task.id,
          agent: "Codex / Cursor",
          mode,
          runnerKind: "real",
          model: "gpt-4o",
          agentVersion: "codex-latest",
          date: new Date().toISOString(),
          files: {},
          transcript: msg,
        };
      }

      const startTime = Date.now();
      const prompt = formatCodexPrompt(task, mode === "mcp");

      // Mode-specific configuration: configure MCP through config file
      if (mode === "mcp") {
        const ebbBinPath = join(process.cwd(), "dist/src/bin.js");
        const codexConfigDir = join(workDir, ".codex");
        mkdirSync(codexConfigDir, { recursive: true });

        const mcpConfig = {
          mcpServers: {
            ebb: {
              command: "node",
              args: [ebbBinPath, "mcp"],
            },
          },
        };
        writeFileSync(join(codexConfigDir, "config.json"), JSON.stringify(mcpConfig, null, 2), "utf-8");
        writeFileSync(join(workDir, ".mcp.json"), JSON.stringify(mcpConfig, null, 2), "utf-8");
      }

      const args = ["exec", prompt];
      const execResult = spawnSync("codex", args, {
        cwd: workDir,
        env: {
          ...process.env,
          CI: "true",
        },
        timeout: 90000,
        encoding: "utf-8",
      });

      const rawTranscript = (execResult.stdout || "") + "\n" + (execResult.stderr || "");
      const safeTranscript = redactKeys(rawTranscript);
      const files = readDirectoryFiles(workDir);

      return {
        taskId: task.id,
        agent: "Codex / Cursor",
        mode,
        runnerKind: "real",
        model: process.env.OPENAI_MODEL || "gpt-4o",
        agentVersion: "codex-latest",
        date: new Date().toISOString(),
        files,
        transcript: safeTranscript,
        durationMs: Date.now() - startTime,
      };
    },
  };
}
