import { createTempRunDir, simulatedCodexRunner } from "../runner.js";
import { type EvalTask, type PickEvaluation, scoreRunFiles } from "../score.js";

export interface RunnerOptions {
  mode: "baseline" | "mcp" | "skill";
}

/**
 * Runner executing Codex / Cursor evaluation via the runner interface (simulated by default).
 * Evaluates tasks by scoring the actual files written in the run directory.
 */
export function runCodex(tasks: EvalTask[], options: RunnerOptions): PickEvaluation[] {
  const evaluations: PickEvaluation[] = [];

  for (const task of tasks) {
    const tempDir = createTempRunDir();
    const result = simulatedCodexRunner.run(task, options.mode, tempDir);
    const scored = scoreRunFiles(task, result.files, result.date);
    evaluations.push(scored);
  }

  return evaluations;
}

/**
 * Formats a task for Codex / Cursor completion.
 */
export function formatCodexPrompt(task: EvalTask, withEbb = false): string {
  const context = `// Task: ${task.prompt}\n// Ecosystem: ${task.ecosystem}\n// File: ${task.targetFile || "package.json"}`;
  if (!withEbb) return `${context}\n// Generate dependency configuration:\n`;

  return `// Context: Ebb verification enabled. Check deprecations before suggesting packages.\n${context}\n// Generate verified dependency configuration:\n`;
}
