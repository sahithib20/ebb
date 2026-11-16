import { check } from "../../src/index.js";
import type { RunnerMode } from "./runner.js";

export interface EvalTask {
  id: string;
  category: string;
  ecosystem: string;
  prompt: string;
  targetFile?: string;
  badPurls?: string[];
  baselinePick: {
    purl: string;
    version: string;
    rationale: string;
  };
  modernPick: {
    purl: string;
    version: string;
    rationale: string;
  };
  replacement: string;
}

export interface PickEvaluation {
  taskId: string;
  purl: string;
  version: string;
  status: string;
  isDeprecatedOrEol: boolean;
  replacement: string | null;
  ruleId: string | null;
}

export interface EvalRunScore {
  agent: string;
  mode: RunnerMode;
  totalTasks: number;
  deprecatedOrEolCount: number;
  supportedCount: number;
  deprecationRatePct: number;
  picks: PickEvaluation[];
}

export interface ExtractedPick {
  purl: string;
  version: string;
  sourceFile: string;
}

/**
 * Normalises an ISO timestamp or date string to YYYY-MM-DD format for Ebb asOf evaluation.
 */
function normalizeDateOnly(date?: string): string | undefined {
  if (!date) return undefined;
  if (date.length >= 10 && date.includes("-")) {
    return date.slice(0, 10);
  }
  return date;
}

/**
 * Converts an npm package name (including scoped packages like @scope/name) to canonical PURL format.
 */
export function npmNameToPurl(name: string): string {
  if (name.startsWith("@")) {
    const slashIdx = name.indexOf("/");
    if (slashIdx !== -1) {
      const scope = name.slice(0, slashIdx);
      const pkg = name.slice(slashIdx + 1);
      return `pkg:npm/%40${encodeURIComponent(scope.slice(1))}/${encodeURIComponent(pkg)}`;
    }
  }
  return `pkg:npm/${encodeURIComponent(name)}`;
}

/**
 * Extracts dependencies from files written in a run folder into standard PURLs.
 * Inspects package.json, requirements.txt, workflow files (*.ya?ml), and Dockerfiles.
 * Prose and transcripts are never parsed.
 */
export function extractPurlsFromFiles(files: Record<string, string>): ExtractedPick[] {
  const extracted: ExtractedPick[] = [];

  for (const [relPath, content] of Object.entries(files)) {
    const lowerPath = relPath.toLowerCase();

    // 1. package.json (npm)
    if (lowerPath.endsWith("package.json")) {
      try {
        const parsed = JSON.parse(content);
        const depSections = [
          parsed.dependencies,
          parsed.devDependencies,
          parsed.peerDependencies,
          parsed.optionalDependencies,
        ];
        for (const section of depSections) {
          if (!section || typeof section !== "object") continue;
          for (const [pkg, spec] of Object.entries(section)) {
            if (typeof spec !== "string") continue;
            // Clean semver spec (^, ~, >=, =, etc.) to extract primary version
            const cleanVer = spec.replace(/^[^\d]*/, "").trim() || "1.0.0";
            extracted.push({
              purl: npmNameToPurl(pkg),
              version: cleanVer,
              sourceFile: relPath,
            });
          }
        }
      } catch {
        // Ignore malformed JSON
      }
    }

    // 2. requirements.txt (PyPI)
    if (lowerPath.endsWith("requirements.txt")) {
      const lines = content.split("\n");
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || line.startsWith("-")) continue;
        const match = line.match(/^([a-zA-Z0-9_.-]+)(?:[~=!<>]+([a-zA-Z0-9_.-]+))?/);
        if (match && match[1]) {
          const pkg = match[1];
          const ver = match[2] || "1.0.0";
          extracted.push({
            purl: `pkg:pypi/${pkg}`,
            version: ver,
            sourceFile: relPath,
          });
        }
      }
    }

    // 3. Workflow files (.github/workflows/*.yml, *.yaml)
    if (lowerPath.includes(".github/workflows/") || lowerPath.endsWith(".yml") || lowerPath.endsWith(".yaml")) {
      const lines = content.split("\n");
      for (const line of lines) {
        const match = line.match(/uses:\s*['"]?([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)(?:\/[^@\s'"]+)?@([^\s'"]+)['"]?/);
        if (match && match[1]) {
          const action = match[1];
          const ref = match[2] || "main";
          extracted.push({
            purl: `pkg:github/${action}`,
            version: ref,
            sourceFile: relPath,
          });
        }
      }
    }

    // 4. Dockerfiles
    if (lowerPath.endsWith("dockerfile") || lowerPath.includes("dockerfile.")) {
      const lines = content.split("\n");
      for (const line of lines) {
        const match = line.match(/^\s*FROM\s+([^\s:]+)(?::([^\s]+))?/i);
        if (match && match[1]) {
          const rawImage = match[1];
          const tag = match[2] || "latest";
          const imagePurl = rawImage.includes("/") ? `pkg:docker/${rawImage}` : `pkg:docker/library/${rawImage}`;
          extracted.push({
            purl: imagePurl,
            version: tag,
            sourceFile: relPath,
          });
        }
      }
    }
  }

  return extracted;
}

/**
 * Scores an agent run strictly from the files written into the run folder.
 * Returns a PickEvaluation marking the task bad if any declared pick is deprecated/EOL.
 */
export function scoreRunFiles(task: EvalTask, files: Record<string, string>, runDate?: string): PickEvaluation {
  const extractedPicks = extractPurlsFromFiles(files);

  if (extractedPicks.length === 0) {
    // Run wrote nothing or no recognised dependencies
    return {
      taskId: task.id,
      purl: "",
      version: "",
      status: "empty",
      isDeprecatedOrEol: false,
      replacement: null,
      ruleId: null,
    };
  }

  const asOf = normalizeDateOnly(runDate);
  let worstPick: PickEvaluation | null = null;

  for (const pick of extractedPicks) {
    const res = check(pick.purl, pick.version, asOf);
    const firstMatch = res.matches?.[0] ?? null;

    // Check if the status indicates deprecated or end-of-life
    const isBadStatus = res.status === "deprecated" || res.status === "end-of-life" || res.status === "unsupported";
    const isExplicitBadPurl = task.badPurls?.some((bad) => pick.purl.toLowerCase().startsWith(bad.toLowerCase())) ?? false;
    const isDeprecatedOrEol = isBadStatus || isExplicitBadPurl;

    const evaluation: PickEvaluation = {
      taskId: task.id,
      purl: pick.purl,
      version: pick.version,
      status: res.status,
      isDeprecatedOrEol,
      replacement: firstMatch?.replacement ?? null,
      ruleId: firstMatch?.ruleId ?? null,
    };

    if (isDeprecatedOrEol) {
      worstPick = evaluation;
      break; // Found a bad pick
    }

    if (!worstPick) {
      worstPick = evaluation;
    }
  }

  return (
    worstPick ?? {
      taskId: task.id,
      purl: "",
      version: "",
      status: "ok",
      isDeprecatedOrEol: false,
      replacement: null,
      ruleId: null,
    }
  );
}

/**
 * Direct evaluation of a specific purl & version (used for direct evaluation / backwards compat).
 */
export function evaluatePick(taskId: string, purl: string, version: string, runDate?: string): PickEvaluation {
  const asOf = normalizeDateOnly(runDate);
  const result = check(purl, version, asOf);
  const isDeprecatedOrEol = result.status !== "ok";
  const firstMatch = result.matches?.[0] ?? null;

  return {
    taskId,
    purl,
    version,
    status: result.status,
    isDeprecatedOrEol,
    replacement: firstMatch?.replacement ?? null,
    ruleId: firstMatch?.ruleId ?? null,
  };
}

/**
 * Calculates aggregate scores and deprecation rate percentage across a set of pick evaluations.
 */
export function computeScore(agent: string, mode: RunnerMode, picks: PickEvaluation[]): EvalRunScore {
  const totalTasks = picks.length;
  const deprecatedOrEolCount = picks.filter((p) => p.isDeprecatedOrEol).length;
  const supportedCount = totalTasks - deprecatedOrEolCount;
  const deprecationRatePct = totalTasks === 0 ? 0 : Math.round((deprecatedOrEolCount / totalTasks) * 1000) / 10;

  return {
    agent,
    mode,
    totalTasks,
    deprecatedOrEolCount,
    supportedCount,
    deprecationRatePct,
    picks,
  };
}
