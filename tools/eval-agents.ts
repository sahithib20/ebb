import { writeReportFromResults } from "../evals/agents/report.js";
import { runAgentEvaluations } from "../evals/agents/run.js";

const isReportOnly = process.argv.includes("--report-only");

if (isReportOnly) {
  writeReportFromResults();
  console.log("[agent-evals] Report regenerated from evals/agents/results.json to evals/agents/REPORT.md");
} else {
  const real = process.argv.includes("--real");
  const repArgIndex = process.argv.indexOf("--repetitions");
  const repetitions =
    repArgIndex !== -1 && process.argv[repArgIndex + 1]
      ? Number.parseInt(process.argv[repArgIndex + 1] as string, 10)
      : 3;

  const res = runAgentEvaluations({ real, repetitions });
  console.log(`[agent-evals] Evaluated ${res.totalTasks} tasks across ${res.repetitions} repetitions.`);
  console.log(
    `[agent-evals] Baseline Deprecation Rate: ${res.headlineSummary.baselineMeanRatePct}% (range: ${res.headlineSummary.baselineRange.join("% - ")}%)`,
  );
  console.log(
    `[agent-evals] With Ebb Deprecation Rate: ${res.headlineSummary.withEbbMeanRatePct}% (range: ${res.headlineSummary.withEbbRange.join("% - ")}%)`,
  );
  console.log("[agent-evals] Raw results saved to evals/agents/results.json");
  console.log("[agent-evals] Report written to evals/agents/REPORT.md");
}
