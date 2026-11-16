import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { EvalTask } from "./score.js";

export type RunnerMode = "baseline" | "mcp" | "skill";
export type RunnerKind = "simulated" | "real";

export interface RunnerRunResult {
  taskId: string;
  agent: string;
  mode: RunnerMode;
  runnerKind: RunnerKind;
  model: string;
  agentVersion: string;
  date: string;
  files: Record<string, string>;
  transcript: string;
  durationMs?: number;
}

export interface AgentRunner {
  name: string;
  kind: RunnerKind;
  model: string;
  agentVersion: string;
  isAvailable?(): boolean;
  run(task: EvalTask, mode: RunnerMode, workDir: string): RunnerRunResult;
}

/**
 * Creates an empty isolated temporary directory for an evaluation run.
 */
export function createTempRunDir(): string {
  return mkdtempSync(join(tmpdir(), "ebb-agent-eval-"));
}

/**
 * Recursively reads all regular files in a directory into a map of relative paths to UTF-8 contents.
 */
export function readDirectoryFiles(dir: string, baseDir = dir): Record<string, string> {
  const result: Record<string, string> = {};
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (entry === ".git" || entry === "node_modules") continue;
    const fullPath = join(dir, entry);
    try {
      const st = statSync(fullPath);
      if (st.isDirectory()) {
        Object.assign(result, readDirectoryFiles(fullPath, baseDir));
      } else if (st.isFile()) {
        const rel = relative(baseDir, fullPath);
        result[rel] = readFileSync(fullPath, "utf-8");
      }
    } catch {
      // Ignore unreadable or transient files
    }
  }

  return result;
}

/**
 * Extracts a friendly package identifier from a purl.
 */
export function parsePurlPackageName(purl: string): string {
  const splitAt = purl.split("@")[0] ?? purl;
  const splitQuestion = splitAt.split("?")[0] ?? splitAt;
  if (splitQuestion.startsWith("pkg:npm/")) {
    const raw = splitQuestion.slice("pkg:npm/".length);
    return decodeURIComponent(raw);
  }
  if (splitQuestion.startsWith("pkg:pypi/")) {
    return splitQuestion.slice("pkg:pypi/".length);
  }
  if (splitQuestion.startsWith("pkg:github/")) {
    return splitQuestion.slice("pkg:github/".length);
  }
  if (splitQuestion.startsWith("pkg:docker/")) {
    const raw = splitQuestion.slice("pkg:docker/".length);
    return raw.replace(/^library\//, "");
  }
  if (splitQuestion.startsWith("pkg:generic/")) {
    return splitQuestion.slice("pkg:generic/".length);
  }
  return purl;
}

/**
 * Writes simulated output files into the run folder for a given task and mode.
 */
export function writeSimulatedFiles(task: EvalTask, mode: RunnerMode, workDir: string): void {
  const pick = mode === "baseline" ? task.baselinePick : task.modernPick;
  const pkgName = parsePurlPackageName(pick.purl);
  const version = pick.version;
  const targetFile = task.targetFile || "package.json";
  const filePath = join(workDir, targetFile);

  // Ensure parent directory exists (e.g. .github/workflows)
  mkdirSync(dirname(filePath), { recursive: true });

  if (targetFile.endsWith("package.json")) {
    const pkgJson = {
      name: "eval-sample",
      version: "1.0.0",
      description: task.prompt,
      dependencies: {
        [pkgName]: version,
      },
    };
    writeFileSync(filePath, JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
  } else if (targetFile.endsWith("requirements.txt")) {
    writeFileSync(filePath, `${pkgName}==${version}\n`, "utf-8");
  } else if (targetFile.endsWith(".yml") || targetFile.endsWith(".yaml")) {
    const workflowYaml = [
      "name: CI",
      "on: [push]",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      `      - uses: ${pkgName}@${version}`,
      "",
    ].join("\n");
    writeFileSync(filePath, workflowYaml, "utf-8");
  } else if (targetFile.toLowerCase().endsWith("dockerfile")) {
    writeFileSync(filePath, `FROM ${pkgName}:${version}\n`, "utf-8");
  } else {
    writeFileSync(filePath, `${pkgName}@${version}\n`, "utf-8");
  }
}

/**
 * Creates a simulated runner compliant with the AgentRunner interface.
 */
export function createSimulatedRunner(name: string, model: string, agentVersion: string): AgentRunner {
  return {
    name,
    kind: "simulated",
    model,
    agentVersion,
    isAvailable: () => true,
    run(task: EvalTask, mode: RunnerMode, workDir: string): RunnerRunResult {
      const startTime = Date.now();
      const date = new Date().toISOString();

      writeSimulatedFiles(task, mode, workDir);

      const files = readDirectoryFiles(workDir);
      const pick = mode === "baseline" ? task.baselinePick : task.modernPick;
      const transcript = `[simulated] ${name} running in mode "${mode}" on task ${task.id}.\nSelected pick: ${pick.purl}@${pick.version} (${pick.rationale})`;

      return {
        taskId: task.id,
        agent: name,
        mode,
        runnerKind: "simulated",
        model,
        agentVersion,
        date,
        files,
        transcript,
        durationMs: Date.now() - startTime,
      };
    },
  };
}

export const simulatedClaudeRunner = createSimulatedRunner("Claude Code", "claude-3-7-sonnet", "0.2.29");
export const simulatedCodexRunner = createSimulatedRunner("Codex / Cursor", "gpt-4o", "1.0.0");
