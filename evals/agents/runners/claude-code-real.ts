import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunner, RunnerMode, RunnerRunResult } from "../runner.js";
import { readDirectoryFiles } from "../runner.js";
import type { EvalTask } from "../score.js";
import { formatClaudePrompt } from "./claude-code.js";

/**
 * Checks whether the Claude Code CLI and required API key are available in the current environment.
 */
export function isClaudeCodeAvailable(): boolean {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  try {
    const probe = spawnSync("claude", ["--version"], { stdio: "ignore" });
    return probe.status === 0;
  } catch {
    return false;
  }
}

/**
 * Redacts sensitive API keys from strings before logging or committing.
 */
export function redactKeys(text: string): string {
  let cleaned = text;
  if (process.env.ANTHROPIC_API_KEY) {
    cleaned = cleaned.replaceAll(process.env.ANTHROPIC_API_KEY, "[REDACTED_ANTHROPIC_KEY]");
  }
  if (process.env.OPENAI_API_KEY) {
    cleaned = cleaned.replaceAll(process.env.OPENAI_API_KEY, "[REDACTED_OPENAI_KEY]");
  }
  // Generic pattern for Anthropic / OpenAI keys
  cleaned = cleaned.replace(/sk-ant-[a-zA-Z0-9_-]{20,}/g, "[REDACTED_ANTHROPIC_KEY]");
  cleaned = cleaned.replace(/sk-[a-zA-Z0-9_-]{20,}/g, "[REDACTED_KEY]");
  return cleaned;
}

/**
 * Real Claude Code runner executing headless tasks via the Claude CLI.
 * Supports baseline, mcp, and skill modes.
 */
export function createRealClaudeCodeRunner(): AgentRunner {
  return {
    name: "Claude Code",
    kind: "real",
    model: process.env.ANTHROPIC_MODEL || "claude-3-7-sonnet",
    agentVersion: "claude-code-latest",
    isAvailable: isClaudeCodeAvailable,
    run(task: EvalTask, mode: RunnerMode, workDir: string): RunnerRunResult {
      if (!isClaudeCodeAvailable()) {
        const msg = "[agent-evals] Claude Code CLI or ANTHROPIC_API_KEY missing; skipping real Claude Code run.";
        console.warn(msg);
        return {
          taskId: task.id,
          agent: "Claude Code",
          mode,
          runnerKind: "real",
          model: "claude-3-7-sonnet",
          agentVersion: "claude-code-latest",
          date: new Date().toISOString(),
          files: {},
          transcript: msg,
        };
      }

      const startTime = Date.now();
      const prompt = formatClaudePrompt(task, mode === "skill");

      // Mode-specific configuration
      if (mode === "mcp") {
        // Configure Ebb MCP server in the run workspace
        const ebbBinPath = join(process.cwd(), "dist/src/bin.js");
        const mcpConfig = {
          mcpServers: {
            ebb: {
              command: "node",
              args: [ebbBinPath, "mcp"],
            },
          },
        };
        writeFileSync(join(workDir, ".mcp.json"), JSON.stringify(mcpConfig, null, 2), "utf-8");
      } else if (mode === "skill") {
        // Configure Ebb check-before-add skill in the run workspace
        const skillDir = join(workDir, ".claude/skills/ebb");
        mkdirSync(skillDir, { recursive: true });
        const skillManifest = {
          name: "ebb",
          description: "Check dependency lifecycle and deprecation before installing packages.",
        };
        writeFileSync(join(skillDir, "skill.json"), JSON.stringify(skillManifest, null, 2), "utf-8");
      }

      const args = ["-p", prompt, "--output-format", "json"];
      const execResult = spawnSync("claude", args, {
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
        agent: "Claude Code",
        mode,
        runnerKind: "real",
        model: process.env.ANTHROPIC_MODEL || "claude-3-7-sonnet",
        agentVersion: "claude-code-latest",
        date: new Date().toISOString(),
        files,
        transcript: safeTranscript,
        durationMs: Date.now() - startTime,
      };
    },
  };
}
