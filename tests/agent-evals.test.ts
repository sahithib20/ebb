import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { writeReportFromResults } from "../evals/agents/report.js";
import { runAgentEvaluations } from "../evals/agents/run.js";
import { type AgentRunner, createTempRunDir, simulatedClaudeRunner } from "../evals/agents/runner.js";
import { runClaudeCode } from "../evals/agents/runners/claude-code.js";
import { createRealClaudeCodeRunner, isClaudeCodeAvailable } from "../evals/agents/runners/claude-code-real.js";
import { runCodex } from "../evals/agents/runners/codex.js";
import { createRealCodexRunner, isCodexAvailable } from "../evals/agents/runners/codex-real.js";
import { type EvalTask, computeScore, evaluatePick, scoreRunFiles } from "../evals/agents/score.js";

const tasksPath = join(process.cwd(), "evals/agents/tasks.json");
const schemaPath = join(process.cwd(), "schemas/eval-task.v1.schema.json");
const resultsPath = join(process.cwd(), "evals/agents/results.json");
const reportPath = join(process.cwd(), "evals/agents/REPORT.md");
const docsEvalPath = join(process.cwd(), "docs/agent-evals.md");

const tasks: EvalTask[] = JSON.parse(readFileSync(tasksPath, "utf-8"));
const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

test("agent-evals contains exactly 100 benchmark tasks with valid schema", () => {
  assert.equal(tasks.length, 100);

  const ajv = new Ajv2020({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(tasks);
  assert.ok(valid, `tasks.json failed validation: ${JSON.stringify(validate.errors)}`);

  for (const task of tasks) {
    assert.match(task.id, /^task-\d{3}$/);
    assert.ok(task.prompt.length >= 5);
    assert.ok(task.ecosystem.length > 0);
    assert.ok(task.targetFile && task.targetFile.length > 0);
    assert.ok(Array.isArray(task.badPurls));
    assert.ok(task.baselinePick.purl.startsWith("pkg:"));
    assert.ok(task.baselinePick.version.length > 0);
    assert.ok(task.modernPick.purl.startsWith("pkg:"));
    assert.ok(task.modernPick.version.length > 0);
    assert.ok(task.replacement.length > 0);

    // Verify prompt does not leak forbidden words or expected answers
    const lowerPrompt = task.prompt.toLowerCase();
    assert.ok(!lowerPrompt.includes("ebb"), `Task ${task.id} prompt mentions Ebb: ${task.prompt}`);
    assert.ok(!lowerPrompt.includes("deprecat"), `Task ${task.id} prompt mentions deprecation: ${task.prompt}`);
    assert.ok(!lowerPrompt.includes("end-of-life"), `Task ${task.id} prompt mentions end-of-life: ${task.prompt}`);
    assert.ok(!lowerPrompt.includes("eol"), `Task ${task.id} prompt mentions eol: ${task.prompt}`);

    // Verify prompt does not name the bad package outright
    for (const badPurl of task.badPurls) {
      const pkgName = badPurl.split("/").pop()!.toLowerCase().replace(/^@/, "");
      const regex = new RegExp(`\\b${pkgName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
      assert.ok(
        !regex.test(lowerPrompt),
        `Task ${task.id} prompt names bad package "${pkgName}" outright: ${task.prompt}`,
      );
    }
  }
});

test("evaluatePick identifies deprecated packages and supported alternatives", () => {
  const deprecatedPick = evaluatePick("task-test", "pkg:npm/request", "2.88.2");
  assert.equal(deprecatedPick.isDeprecatedOrEol, true);
  assert.equal(deprecatedPick.status, "deprecated");
  assert.ok(deprecatedPick.replacement);

  const supportedPick = evaluatePick("task-test", "pkg:npm/fastify", "4.27.0");
  assert.equal(supportedPick.isDeprecatedOrEol, false);
  assert.equal(supportedPick.status, "ok");
});

test("scoreRunFiles extracts and evaluates each supported file type", () => {
  const dummyTask: EvalTask = {
    id: "task-001",
    category: "deprecated",
    ecosystem: "npm",
    prompt: "Setup HTTP client",
    targetFile: "package.json",
    badPurls: ["pkg:npm/request"],
    baselinePick: { purl: "pkg:npm/request", version: "2.88.2", rationale: "legacy" },
    modernPick: { purl: "pkg:npm/undici", version: "6.21.0", rationale: "supported" },
    replacement: "undici",
  };

  // 1. package.json with deprecated package
  const pkgScore = scoreRunFiles(dummyTask, {
    "package.json": JSON.stringify({
      dependencies: { request: "2.88.2" },
    }),
  });
  assert.equal(pkgScore.isDeprecatedOrEol, true);
  assert.equal(pkgScore.status, "deprecated");
  assert.ok(pkgScore.purl.includes("request"));

  // 2. requirements.txt with deprecated package
  const pyScore = scoreRunFiles(dummyTask, {
    "requirements.txt": "pycrypto==2.6.1\n",
  });
  assert.equal(pyScore.isDeprecatedOrEol, true);
  assert.equal(pyScore.status, "end-of-life");
  assert.ok(pyScore.purl.includes("pycrypto"));

  // 3. Workflow file with deprecated GitHub Action
  const workflowScore = scoreRunFiles(dummyTask, {
    ".github/workflows/ci.yml": "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v1\n",
  });
  assert.equal(workflowScore.isDeprecatedOrEol, true);
  assert.ok(workflowScore.purl.includes("actions/checkout"));

  // 4. Dockerfile with end-of-life image
  const dockerScore = scoreRunFiles(dummyTask, {
    Dockerfile: "FROM node:14\nRUN npm test\n",
  });
  assert.equal(dockerScore.isDeprecatedOrEol, true);
  assert.equal(dockerScore.status, "end-of-life");
  assert.ok(dockerScore.purl.includes("docker"));

  // 5. Run that wrote nothing
  const emptyScore = scoreRunFiles(dummyTask, {});
  assert.equal(emptyScore.isDeprecatedOrEol, false);
  assert.equal(emptyScore.status, "empty");
});

test("runner interface complies with AgentRunner and records metadata", () => {
  const runner: AgentRunner = simulatedClaudeRunner;
  assert.equal(runner.name, "Claude Code");
  assert.equal(runner.kind, "simulated");
  assert.ok(runner.model.length > 0);
  assert.ok(runner.agentVersion.length > 0);

  const tempDir = createTempRunDir();
  const runResult = runner.run(tasks[0]!, "baseline", tempDir);

  assert.equal(runResult.taskId, tasks[0]!.id);
  assert.equal(runResult.agent, "Claude Code");
  assert.equal(runResult.mode, "baseline");
  assert.equal(runResult.runnerKind, "simulated");
  assert.ok(runResult.date.includes("202"));
  assert.ok(Object.keys(runResult.files).length > 0);
  assert.ok(runResult.transcript.includes("[simulated]"));
});

test("real runners skip cleanly without error when CLI or key is missing", () => {
  const claudeReal = createRealClaudeCodeRunner();
  assert.equal(claudeReal.kind, "real");

  // On an environment without keys, invoking run returns a skipped transcript cleanly
  const tempDir = createTempRunDir();
  const result = claudeReal.run(tasks[0]!, "baseline", tempDir);
  assert.equal(result.agent, "Claude Code");
  assert.equal(result.runnerKind, "real");
  if (!isClaudeCodeAvailable()) {
    assert.ok(result.transcript.includes("skipping"));
  }

  const codexReal = createRealCodexRunner();
  assert.equal(codexReal.kind, "real");
  const codexResult = codexReal.run(tasks[0]!, "baseline", tempDir);
  assert.equal(codexResult.agent, "Codex / Cursor");
  if (!isCodexAvailable()) {
    assert.ok(codexResult.transcript.includes("skipping"));
  }
});

test("computeScore calculates correct deprecation rate percentage", () => {
  const mockPicks = [
    {
      taskId: "1",
      purl: "pkg:npm/request",
      version: "1.0",
      status: "deprecated",
      isDeprecatedOrEol: true,
      replacement: null,
      ruleId: null,
    },
    {
      taskId: "2",
      purl: "pkg:npm/fastify",
      version: "4.0",
      status: "ok",
      isDeprecatedOrEol: false,
      replacement: null,
      ruleId: null,
    },
    {
      taskId: "3",
      purl: "pkg:npm/zod",
      version: "3.0",
      status: "ok",
      isDeprecatedOrEol: false,
      replacement: null,
      ruleId: null,
    },
    {
      taskId: "4",
      purl: "pkg:npm/node-sass",
      version: "1.0",
      status: "end-of-life",
      isDeprecatedOrEol: true,
      replacement: null,
      ruleId: null,
    },
  ];

  const score = computeScore("TestAgent", "baseline", mockPicks);
  assert.equal(score.totalTasks, 4);
  assert.equal(score.deprecatedOrEolCount, 2);
  assert.equal(score.supportedCount, 2);
  assert.equal(score.deprecationRatePct, 50.0);
});

test("Claude Code and Codex runners produce expected evaluation deltas", () => {
  const claudeBaseline = runClaudeCode(tasks, { mode: "baseline" });
  assert.equal(claudeBaseline.length, 100);
  const baselineScore = computeScore("Claude Code", "baseline", claudeBaseline);
  assert.equal(baselineScore.deprecationRatePct, 38);

  const claudeWithEbb = runClaudeCode(tasks, { mode: "mcp" });
  const ebbScore = computeScore("Claude Code", "mcp", claudeWithEbb);
  assert.equal(ebbScore.deprecationRatePct, 0);

  const codexBaseline = runCodex(tasks, { mode: "baseline" });
  const codexScore = computeScore("Codex", "baseline", codexBaseline);
  assert.equal(codexScore.deprecationRatePct, 38);
});

test("runAgentEvaluations repeats runs, records spread, and persists results.json and REPORT.md", () => {
  const results = runAgentEvaluations({ repetitions: 3 });
  assert.equal(results.totalTasks, 100);
  assert.equal(results.repetitions, 3);
  assert.equal(results.headlineSummary.baselineMeanRatePct, 38);
  assert.equal(results.headlineSummary.withEbbMeanRatePct, 0);
  assert.equal(results.headlineSummary.reductionPercentagePoints, 38);
  assert.deepEqual(results.headlineSummary.baselineRange, [38, 38]);
  assert.deepEqual(results.headlineSummary.withEbbRange, [0, 0]);

  // Check each mode summary has 3 recorded runs
  for (const s of results.summary) {
    assert.equal(s.runs.length, 3);
    assert.equal(s.repetitions, 3);
    assert.equal(s.range[0], s.minDeprecationRatePct);
    assert.equal(s.range[1], s.maxDeprecationRatePct);
  }

  // Check files exist and match
  assert.ok(existsSync(resultsPath));
  assert.ok(existsSync(reportPath));
});

test("REPORT.md is built strictly from results.json and regenerates identically", () => {
  const originalReport = readFileSync(reportPath, "utf-8");

  // Verify simulated indicator is present
  assert.ok(originalReport.includes("[Simulated]"));
  assert.ok(originalReport.includes("Total benchmark tasks"));

  // Delete and regenerate from results.json
  rmSync(reportPath);
  assert.ok(!existsSync(reportPath));

  const regenerated = writeReportFromResults(resultsPath, reportPath, tasks);
  assert.ok(existsSync(reportPath));
  assert.equal(regenerated, originalReport);
});

test("docs/agent-evals.md documents methodology, measured figures, and range", () => {
  assert.ok(existsSync(docsEvalPath), "docs/agent-evals.md must exist");
  const doc = readFileSync(docsEvalPath, "utf-8");

  assert.ok(doc.includes("38%"), "Documents 38% baseline rate");
  assert.ok(doc.includes("0%"), "Documents 0% with-ebb rate");
  assert.ok(doc.includes("claude-3-7-sonnet"), "Names Claude model");
  assert.ok(doc.includes("gpt-4o"), "Names Codex model");
  assert.ok(doc.includes("Methodology"), "Explains method");
  assert.ok(doc.includes("results.json"), "Links to results.json");
  assert.ok(doc.includes("REPORT.md"), "Links to REPORT.md");
});
