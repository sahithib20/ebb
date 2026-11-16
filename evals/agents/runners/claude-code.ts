import { createTempRunDir, simulatedClaudeRunner } from "../runner.js";
import { type EvalTask, type PickEvaluation, scoreRunFiles } from "../score.js";

export interface RunnerOptions {
  mode: "baseline" | "mcp" | "skill";
}

/**
 * Runner executing Claude Code evaluation via the runner interface (simulated by default).
 * Evaluates tasks by scoring the actual files written in the run directory.
 */
export function runClaudeCode(tasks: EvalTask[], options: RunnerOptions): PickEvaluation[] {
  const evaluations: PickEvaluation[] = [];

  for (const task of tasks) {
    const tempDir = createTempRunDir();
    const result = simulatedClaudeRunner.run(task, options.mode, tempDir);
    const scored = scoreRunFiles(task, result.files, result.date);
    evaluations.push(scored);
  }

  return evaluations;
}

/**
 * Formats a task into a Claude Code prompt with or without the Ebb skill instructions.
 */
export function formatClaudePrompt(task: EvalTask, withSkill = false): string {
  const base = `User request: ${task.prompt}\nEcosystem: ${task.ecosystem}\nTarget file: ${task.targetFile || "package.json"}\nGenerate the complete dependency configuration file.`;
  if (!withSkill) return base;

  return `System instructions: You have the official Ebb "check-before-add" skill enabled.
Before recommending or adding any package or runtime version, verify its lifecycle status with Ebb.
Never recommend deprecated or end-of-life components.

${base}`;
}
