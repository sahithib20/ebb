import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateMarkdownReport } from "./report.js";
import {
  type AgentRunner,
  type RunnerMode,
  createTempRunDir,
  simulatedClaudeRunner,
  simulatedCodexRunner,
} from "./runner.js";
import { createRealClaudeCodeRunner, isClaudeCodeAvailable } from "./runners/claude-code-real.js";
import { createRealCodexRunner, isCodexAvailable } from "./runners/codex-real.js";
import {
  type EvalRunScore,
  type EvalTask,
  type PickEvaluation,
  computeScore,
  scoreRunFiles,
} from "./score.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tasksPath = join(__dirname, "../../../evals/agents/tasks.json");
const resultsPath = join(__dirname, "../../../evals/agents/results.json");
const reportPath = join(__dirname, "../../../evals/agents/REPORT.md");

export interface ModeSummary {
  agent: string;
  mode: RunnerMode;
  runnerKind: "simulated" | "real";
  model: string;
  agentVersion: string;
  repetitions: number;
  runs: EvalRunScore[];
  meanDeprecationRatePct: number;
  minDeprecationRatePct: number;
  maxDeprecationRatePct: number;
  range: [number, number];
}

export interface FullBenchmarkResults {
  timestamp: string;
  totalTasks: number;
  repetitions: number;
  summary: ModeSummary[];
  headlineSummary: {
    baselineMeanRatePct: number;
    baselineDeprecationRatePct: number;
    withEbbMeanRatePct: number;
    withEbbDeprecationRatePct: number;
    reductionPercentagePoints: number;
    baselineRange: [number, number];
    withEbbRange: [number, number];
  };
  runs: EvalRunScore[];
}

export interface RunOptions {
  repetitions?: number;
  real?: boolean;
}

export function runAgentEvaluations(options: RunOptions = {}): FullBenchmarkResults {
  const repetitions = options.repetitions ?? 3;
  const useReal = options.real ?? false;

  const tasksRaw = readFileSync(tasksPath, "utf-8");
  const tasks: EvalTask[] = JSON.parse(tasksRaw);

  // Select runners based on availability and requested mode
  let claudeRunner: AgentRunner = simulatedClaudeRunner;
  let codexRunner: AgentRunner = simulatedCodexRunner;

  if (useReal) {
    if (isClaudeCodeAvailable()) {
      claudeRunner = createRealClaudeCodeRunner();
    } else {
      console.warn("[agent-evals] Claude Code CLI or API key unavailable; using simulated runner.");
    }

    if (isCodexAvailable()) {
      codexRunner = createRealCodexRunner();
    } else {
      console.warn("[agent-evals] Codex CLI or API key unavailable; using simulated runner.");
    }
  }

  const configurations: Array<{ runner: AgentRunner; mode: RunnerMode }> = [
    { runner: claudeRunner, mode: "baseline" },
    { runner: claudeRunner, mode: "mcp" },
    { runner: claudeRunner, mode: "skill" },
    { runner: codexRunner, mode: "baseline" },
    { runner: codexRunner, mode: "mcp" },
  ];

  const summary: ModeSummary[] = [];

  for (const { runner, mode } of configurations) {
    const modeRuns: EvalRunScore[] = [];

    for (let r = 0; r < repetitions; r++) {
      const picks: PickEvaluation[] = [];

      for (const task of tasks) {
        const tempDir = createTempRunDir();
        const runResult = runner.run(task, mode, tempDir);
        const pickEval = scoreRunFiles(task, runResult.files, runResult.date);
        picks.push(pickEval);
      }

      const score = computeScore(runner.name, mode, picks);
      modeRuns.push(score);
    }

    const rates = modeRuns.map((r) => r.deprecationRatePct);
    const meanRate = Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10;
    const minRate = Math.min(...rates);
    const maxRate = Math.max(...rates);

    summary.push({
      agent: runner.name,
      mode,
      runnerKind: runner.kind,
      model: runner.model,
      agentVersion: runner.agentVersion,
      repetitions,
      runs: modeRuns,
      meanDeprecationRatePct: meanRate,
      minDeprecationRatePct: minRate,
      maxDeprecationRatePct: maxRate,
      range: [minRate, maxRate],
    });
  }

  const claudeBaselineSummary = summary.find((s) => s.agent === "Claude Code" && s.mode === "baseline")!;
  const claudeSkillSummary = summary.find((s) => s.agent === "Claude Code" && s.mode === "skill")!;

  const headlineSummary = {
    baselineMeanRatePct: claudeBaselineSummary.meanDeprecationRatePct,
    baselineDeprecationRatePct: claudeBaselineSummary.meanDeprecationRatePct,
    withEbbMeanRatePct: claudeSkillSummary.meanDeprecationRatePct,
    withEbbDeprecationRatePct: claudeSkillSummary.meanDeprecationRatePct,
    reductionPercentagePoints:
      Math.round((claudeBaselineSummary.meanDeprecationRatePct - claudeSkillSummary.meanDeprecationRatePct) * 10) / 10,
    baselineRange: claudeBaselineSummary.range,
    withEbbRange: claudeSkillSummary.range,
  };

  // Provide representative run array for backward compatibility
  const runs: EvalRunScore[] = summary
    .map((s) => s.runs[0])
    .filter((run): run is EvalRunScore => run !== undefined);

  const results: FullBenchmarkResults = {
    timestamp: new Date().toISOString(),
    totalTasks: tasks.length,
    repetitions,
    summary,
    headlineSummary,
    runs,
  };

  writeFileSync(resultsPath, JSON.stringify(results, null, 2), "utf-8");

  // Generate REPORT.md strictly from results.json data
  const reportMarkdown = generateMarkdownReport(results, tasks);
  writeFileSync(reportPath, reportMarkdown, "utf-8");

  return results;
}

if (process.argv[1] && process.argv[1].endsWith("run.js")) {
  const real = process.argv.includes("--real");
  const repArgIndex = process.argv.indexOf("--repetitions");
  const repetitions =
    repArgIndex !== -1 && process.argv[repArgIndex + 1]
      ? Number.parseInt(process.argv[repArgIndex + 1] as string, 10)
      : 3;

  const res = runAgentEvaluations({ real, repetitions });
  console.log(`[agent-evals] Evaluated ${res.totalTasks} tasks with ${res.repetitions} repetitions.`);
  console.log(
    `[agent-evals] Baseline Deprecation Rate: ${res.headlineSummary.baselineMeanRatePct}% (range: ${res.headlineSummary.baselineRange.join("% - ")}%)`,
  );
  console.log(
    `[agent-evals] With Ebb Deprecation Rate: ${res.headlineSummary.withEbbMeanRatePct}% (range: ${res.headlineSummary.withEbbRange.join("% - ")}%)`,
  );
  console.log("[agent-evals] Report written to evals/agents/REPORT.md");
}
