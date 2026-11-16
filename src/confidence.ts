import type { EvidenceSource } from "./domain.js";
import type { RegistryV2Rule } from "./registry.js";

/**
 * Three confidence tiers indicating how far a rule and its deadline can be trusted.
 * - confirmed: primary vendor/upstream source, stated deadline, human verified.
 * - likely: official importer or derived from vendor cadence/secondary source.
 * - tentative: inferred date, incomplete vendor source, or community estimate.
 */
export type RuleConfidence = "confirmed" | "likely" | "tentative";

export const CONFIDENCE_LEVELS: readonly RuleConfidence[] = ["confirmed", "likely", "tentative"] as const;

const SECONDARY_AGGREGATOR_DOMAINS = new Set(["endoflife.date", "wikipedia.org", "repology.org", "wikidata.org"]);

/**
 * Checks whether an evidence source is from an authoritative primary/upstream publisher
 * rather than a third-party aggregator. Does not perform network requests.
 */
export function isOfficialSource(source: EvidenceSource | { url: string } | string): boolean {
  const urlStr = typeof source === "string" ? source : source?.url;
  if (!urlStr || typeof urlStr !== "string") return false;
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    for (const domain of SECONDARY_AGGREGATOR_DOMAINS) {
      if (host === domain || host.endsWith(`.${domain}`)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Determines the confidence level of a rule.
 * 1. Uses explicit `rule.confidence` if set to a valid level.
 * 2. Otherwise derives it: manual review plus at least one official source yields "confirmed";
 *    importer-only or secondary-only sources yield "likely".
 * 3. Never derives "tentative" automatically (tentative must be explicitly declared).
 */
export function confidenceOf(rule: Partial<RegistryV2Rule> | Record<string, unknown>): RuleConfidence {
  if (rule.confidence === "confirmed" || rule.confidence === "likely" || rule.confidence === "tentative") {
    return rule.confidence;
  }

  const prov = rule.provenance as { method?: string; reviewedAt?: string } | undefined;
  const isManualOrUpstream = prov?.method === "manual" || prov?.method === "upstream";
  const hasReviewedAt = typeof prov?.reviewedAt === "string" && prov.reviewedAt.length > 0;
  const sources = Array.isArray(rule.sources) ? (rule.sources as Array<{ url: string }>) : [];
  const hasOfficialSource = sources.length > 0 && sources.some((s) => isOfficialSource(s));

  if (isManualOrUpstream && hasReviewedAt && hasOfficialSource) {
    return "confirmed";
  }

  return "likely";
}
