import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CheckAllEntry, CheckAllResult, CheckMatch, CheckResult } from "../index.js";
import { sourcesOf } from "../index.js";
import { confidenceOf, type RuleConfidence } from "../confidence.js";
import type { RegistryV2Rule } from "../registry.js";
import { getOffingHint } from "./hint.js";

export interface FormattedMatch extends CheckMatch {
  reviewer: string | null;
  confidence: RuleConfidence;
  confidenceNote?: string | null;
  verificationAdvice?: string;
}

export interface FormattedCheckResult extends Omit<CheckResult, "matches"> {
  matches: FormattedMatch[];
  provenance: {
    sources: string[];
    reviewers: string[];
  };
  hint?: string;
  verificationAdvice?: string;
}

interface IndexedRuleMeta {
  reviewer: string | null;
  reviewedAt: string | null;
  confidence?: RuleConfidence | undefined;
  confidenceNote?: string | null | undefined;
}

let provenanceIndex: Map<string, IndexedRuleMeta> | undefined;

function buildProvenanceIndex(): Map<string, IndexedRuleMeta> {
  if (provenanceIndex !== undefined) {
    return provenanceIndex;
  }

  const index = new Map<string, IndexedRuleMeta>();
  const candidates = [
    resolve(process.cwd(), "registry"),
    resolve(process.cwd(), "../../registry"),
    resolve(process.cwd(), "../../../registry"),
  ];

  let regDir = "";
  for (const cand of candidates) {
    if (existsSync(cand)) {
      regDir = cand;
      break;
    }
  }

  if (regDir) {
    const files = readdirSync(regDir).filter((f) => f.endsWith(".json") && !f.includes("lock") && !f.includes("shas"));
    for (const file of files) {
      try {
        const content = readFileSync(resolve(regDir, file), "utf8");
        const data = JSON.parse(content) as { rules?: Array<Record<string, unknown>> };
        for (const rule of data.rules ?? []) {
          const ruleId = typeof rule.id === "string" ? rule.id : "";
          if (ruleId) {
            const prov =
              typeof rule.provenance === "object" && rule.provenance !== null
                ? (rule.provenance as { reviewer?: string; reviewedAt?: string })
                : undefined;
            index.set(ruleId, {
              reviewer: prov?.reviewer ?? null,
              reviewedAt: prov?.reviewedAt ?? null,
              confidence: typeof rule.confidence === "string" ? (rule.confidence as RuleConfidence) : undefined,
              confidenceNote: typeof rule.confidenceNote === "string" ? rule.confidenceNote : null,
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  provenanceIndex = index;
  return index;
}

export function formatCheckResult(result: CheckResult): FormattedCheckResult {
  const index = buildProvenanceIndex();
  const sourceUrls = new Set<string>();
  const reviewerNames = new Set<string>();
  let hasTentative = false;

  const formattedMatches: FormattedMatch[] = result.matches.map((match) => {
    const meta = index.get(match.ruleId);
    const reviewer = meta?.reviewer ?? null;

    if (reviewer) {
      reviewerNames.add(reviewer);
    }

    let matchSources = match.sources;
    try {
      const so = sourcesOf(match.ruleId);
      if (so?.sources && so.sources.length > 0) {
        matchSources = so.sources as unknown as typeof match.sources;
      }
    } catch {
      // Keep match.sources on error
    }

    for (const source of matchSources) {
      if (source?.url) {
        sourceUrls.add(source.url);
      }
    }

    const confidence: RuleConfidence =
      match.confidence ?? meta?.confidence ?? confidenceOf(match as unknown as RegistryV2Rule);
    const confidenceNote = meta?.confidenceNote ?? null;
    const isTentative = confidence === "tentative";
    if (isTentative) {
      hasTentative = true;
    }

    const formattedMatch: FormattedMatch = {
      ...match,
      sources: matchSources,
      reviewer,
      confidence,
      ...(confidenceNote ? { confidenceNote } : {}),
      ...(isTentative
        ? {
            verificationAdvice:
              "This finding has tentative confidence. Verify it against primary sources before acting on it.",
          }
        : {}),
    };

    return formattedMatch;
  });

  const hint = getOffingHint(result.status);

  return {
    ...result,
    matches: formattedMatches,
    provenance: {
      sources: Array.from(sourceUrls),
      reviewers: Array.from(reviewerNames),
    },
    ...(hint ? { hint } : {}),
    ...(hasTentative
      ? {
          verificationAdvice:
            "One or more findings have tentative confidence: please verify them against primary documentation before taking action.",
        }
      : {}),
  };
}

export function formatCheckAllResult(result: CheckAllResult): {
  results: Array<FormattedCheckResult | (CheckAllEntry & { status: "error" })>;
  summary: CheckAllResult["summary"];
  provenance: {
    sources: string[];
    reviewers: string[];
  };
  hint?: string;
} {
  const allSources = new Set<string>();
  const allReviewers = new Set<string>();

  const formattedResults = result.results.map((entry) => {
    if (entry.status === "error") {
      return entry;
    }
    const formatted = formatCheckResult(entry as CheckResult);
    for (const s of formatted.provenance.sources) {
      allSources.add(s);
    }
    for (const r of formatted.provenance.reviewers) {
      allReviewers.add(r);
    }
    return formatted;
  });

  const hasIssues =
    result.summary.byStatus && Object.entries(result.summary.byStatus).some(([s, count]) => s !== "ok" && count > 0);
  const rootHint = hasIssues ? getOffingHint("deprecated") : null;

  return {
    results: formattedResults,
    summary: result.summary,
    provenance: {
      sources: Array.from(allSources),
      reviewers: Array.from(allReviewers),
    },
    ...(rootHint ? { hint: rootHint } : {}),
  };
}
