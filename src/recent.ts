/**
 * `recent({ within, ecosystem, purls, asOf, rules })`:
 * List lifecycle deadlines that have passed within a recent time window.
 */

import { BUNDLED_ECOSYSTEMS } from "./data/ecosystems.js";
import { loadEcosystemSync } from "./data/load.js";
import type { EvidenceSource, Severity } from "./domain.js";
import { EbbError } from "./errors.js";
import { parsePurl, purlIdentity } from "./purl.js";
import { isIsoDate, type LifecycleEvent, type RegistryV2Rule } from "./registry.js";
import { addDays, addMonths, parseWithinWindow, UpcomingError } from "./upcoming.js";
import { versContains } from "./vers.js";

export { UpcomingError as RecentError };

export interface RecentItem {
  readonly ruleId: string;
  readonly purl: string;
  readonly ecosystem: string;
  readonly event: LifecycleEvent;
  readonly title: string;
  readonly severity: Severity;
  readonly deadline: string;
  readonly daysAgo: number;
  readonly estimated: boolean;
  readonly replacement: string | null;
  readonly sources: EvidenceSource[];
  readonly reviewedAt: string | null;
  readonly datePrecision?: "day" | "month" | undefined;
}

export interface RecentOptions {
  readonly within?: string | number | undefined;
  readonly ecosystem?: string | readonly string[] | undefined;
  readonly purls?: readonly string[] | undefined;
  readonly asOf?: string | undefined;
  readonly rules?: readonly RegistryV2Rule[] | undefined;
}

export interface RecentResult {
  readonly asOf: string;
  readonly within: string;
  readonly since: string;
  readonly count: number;
  readonly items: RecentItem[];
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const MS_PER_DAY = 86_400_000;

interface ParsedTargetPurl {
  identity: string;
  version?: string | undefined;
}

function parseTargetPurl(purlStr: string): ParsedTargetPurl {
  try {
    const parsed = parsePurl(purlStr);
    return {
      identity: purlIdentity(parsed),
      version: parsed.version,
    };
  } catch {
    return { identity: purlStr.trim() };
  }
}

/** Compute the past start date (since) for a given within window. */
export function computeSinceDate(within: string | number | undefined, asOf: string): { span: string; since: string } {
  const parsed = parseWithinWindow(within, asOf);
  if (typeof within === "string") {
    const trimmed = within.trim();
    const match = /^(\d+)\s*([dwmyDWMY])?$/.exec(trimmed);
    if (match) {
      const amount = Number.parseInt(match[1]!, 10);
      const unit = (match[2] ?? "d").toLowerCase();
      if (unit === "m") {
        return { span: parsed.span, since: addMonths(asOf, -amount) };
      }
      if (unit === "y") {
        return { span: parsed.span, since: addMonths(asOf, -amount * 12) };
      }
    }
  }
  return { span: parsed.span, since: addDays(asOf, -parsed.days) };
}

/**
 * Returns software lifecycle events that ended lately within the specified time window.
 */
export function recent(options: RecentOptions = {}): RecentResult {
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  if (!isIsoDate(asOf)) {
    throw new EbbError("invalid-date", `"${asOf}" is not a date (YYYY-MM-DD).`);
  }

  const { span, since } = computeSinceDate(options.within, asOf);

  const ecosystemFilter: Set<string> | undefined = options.ecosystem
    ? new Set(
        (Array.isArray(options.ecosystem) ? options.ecosystem : [options.ecosystem])
          .map((eco) => eco.trim().toLowerCase())
          .filter(Boolean),
      )
    : undefined;

  const targetPurls: ParsedTargetPurl[] | undefined =
    options.purls && options.purls.length > 0 ? options.purls.map(parseTargetPurl) : undefined;

  let candidateRules: readonly RegistryV2Rule[];
  if (options.rules) {
    candidateRules = options.rules;
  } else if (ecosystemFilter && ecosystemFilter.size > 0) {
    const collected: RegistryV2Rule[] = [];
    for (const eco of ecosystemFilter) {
      if ((BUNDLED_ECOSYSTEMS as readonly string[]).includes(eco)) {
        collected.push(...loadEcosystemSync(eco));
      }
    }
    candidateRules = collected;
  } else {
    const collected: RegistryV2Rule[] = [];
    for (const eco of BUNDLED_ECOSYSTEMS) {
      collected.push(...loadEcosystemSync(eco));
    }
    candidateRules = collected;
  }

  const items: RecentItem[] = [];
  const seenRuleIds = new Set<string>();

  for (const rule of candidateRules) {
    const deadline = rule.deadline;
    if (!deadline || !isIsoDate(deadline)) {
      continue;
    }

    // Must fall within the [since, asOf] window
    if (deadline < since || deadline > asOf) {
      continue;
    }

    if (ecosystemFilter && !ecosystemFilter.has(rule.ecosystem.toLowerCase())) {
      continue;
    }

    if (targetPurls) {
      let ruleIdentity: string;
      try {
        ruleIdentity = purlIdentity(rule.purl);
      } catch {
        ruleIdentity = rule.purl;
      }

      const matchesAnyTarget = targetPurls.some((target) => {
        if (target.identity !== ruleIdentity) return false;
        if (target.version) {
          try {
            return versContains(rule.vers, target.version);
          } catch {
            return false;
          }
        }
        return true;
      });

      if (!matchesAnyTarget) {
        continue;
      }
    }

    if (seenRuleIds.has(rule.id)) {
      continue;
    }
    seenRuleIds.add(rule.id);

    const diffMs = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${deadline}T00:00:00Z`);
    const daysAgo = Math.max(0, Math.floor(diffMs / MS_PER_DAY));

    const ruleRecord = rule as unknown as Record<string, unknown>;
    const rubyMetadata = rule["x-ruby"] as { estimated?: unknown } | undefined;
    const isEstimated = Boolean(
      rubyMetadata?.estimated ??
        rule["x-estimated"] ??
        ruleRecord.estimated ??
        (rule.event === "scheduled-end-of-life" && ruleRecord.tentative) ??
        false,
    );

    let datePrecision: "day" | "month" | undefined;
    for (const [key, value] of Object.entries(rule)) {
      if (!key.startsWith("x-") || typeof value !== "object" || value === null) continue;
      const month = (value as Record<string, unknown>).endOfLifeMonth;
      if (typeof month === "string" && /^\d{4}-\d{2}$/.test(month)) {
        datePrecision = "month";
        break;
      }
    }

    items.push({
      ruleId: rule.id,
      purl: rule.purl,
      ecosystem: rule.ecosystem,
      event: rule.event,
      title: rule.title,
      severity: rule.severity,
      deadline,
      daysAgo,
      estimated: isEstimated,
      replacement: rule.replacement ?? null,
      sources: rule.sources ?? [],
      reviewedAt: rule.provenance?.reviewedAt ?? null,
      ...(datePrecision !== undefined ? { datePrecision } : {}),
    });
  }

  // Sort: date descending (most recent first), then severity descending, then ruleId ascending
  items.sort((a, b) => {
    const dateComp = b.deadline.localeCompare(a.deadline);
    if (dateComp !== 0) return dateComp;
    const sevComp = (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
    if (sevComp !== 0) return sevComp;
    return a.ruleId.localeCompare(b.ruleId);
  });

  return {
    asOf,
    within: span,
    since,
    count: items.length,
    items,
  };
}
