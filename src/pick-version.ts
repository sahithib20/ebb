/**
 * `supportedVersions`: which release lines Ebb knows, and which one it would take.
 * A line is named only when a rule's VERS range is exactly one release step. Ebb does not
 * invent lines it has no rule for, and it does not call a line supported.
 */

import { CheckError, resolveCandidateRules } from "./check-core.js";
import { EbbError } from "./errors.js";
import { productsFromRules, rankProductsForName } from "./product-name.js";
import { normalizePurl, parsePurl, purlIdentity } from "./purl.js";
import { isIsoDate, lifecycleEventPrecedence } from "./registry.js";
import type { LifecycleEvent, RegistryV2Rule } from "./registry.js";
import { daysLeft } from "./result.js";
import { releaseLineFromVers } from "./rule-versions.js";
import { versionScheme } from "./vers.js";

/** How far ahead an end date must sit before Ebb will recommend that line. */
export const RECOMMEND_AFTER_DAYS = 180;

/** `ended` is on or before the reference day, `ending` is later, `no-known-end` has no date. */
export type ReleaseLineStatus = "ended" | "ending" | "no-known-end";

/** One release line taken from the rule that carries the most serious event for that line. */
export interface ReleaseLine {
  readonly id: string;
  readonly vers: string;
  readonly status: ReleaseLineStatus;
  readonly endDate: string | null;
  readonly ruleId: string;
  readonly event: LifecycleEvent;
}

/** The line Ebb would take, with the sentence that explains the choice. */
export interface VersionRecommendation {
  readonly lineId: string;
  readonly reason: string;
}

export interface SupportedVersionsOptions {
  /** Reference day (`YYYY-MM-DD`). When omitted, the UTC calendar day is read once. */
  readonly asOf?: string | undefined;
  /** Rules to read instead of the active registry. Observed-at filtering still applies. */
  readonly rules?: readonly RegistryV2Rule[] | undefined;
}

/** Release lines, the recommendation, and whether the numbered lines have gaps. */
export interface SupportedVersionsResult {
  /** Canonical package URL, or null when a product name matches nothing. */
  readonly purl: string | null;
  readonly asOf: string;
  readonly lines: readonly ReleaseLine[];
  readonly recommendation: VersionRecommendation | null;
  /** Why that line was chosen, or why none was. */
  readonly reason: string;
  /**
   * True only when a `*` rule covers every version, or the numbered lines from the oldest
   * known line through the newest have no gap. A note about versions newer than the last
   * rule does not by itself make this false.
   */
  readonly complete: boolean;
  readonly notes: readonly string[];
}

function requireIsoDate(value: string): void {
  if (!isIsoDate(value)) throw new EbbError("invalid-date", `"${value}" is not a date (YYYY-MM-DD).`);
}

/** The UTC calendar day. Called only when the caller did not pass `asOf`. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isReleaseRule(rule: RegistryV2Rule): boolean {
  return rule.usage === undefined || rule.usage.some((matcher) => matcher.kind !== "symbol");
}

function effectiveEvent(rule: RegistryV2Rule, asOf: string): LifecycleEvent {
  if (rule.event === "scheduled-end-of-life" && rule.deadline !== undefined && rule.deadline <= asOf) {
    return "end-of-life";
  }
  return rule.event;
}

function seriousness(event: LifecycleEvent): number {
  const index = lifecycleEventPrecedence.indexOf(event);
  return index === -1 ? lifecycleEventPrecedence.length : index;
}

function lineStatus(event: LifecycleEvent, deadline: string | undefined, asOf: string): ReleaseLineStatus {
  if (deadline !== undefined) return deadline <= asOf ? "ended" : "ending";
  if (event === "scheduled-end-of-life" || event === "end-of-active-support") return "no-known-end";
  return "ended";
}

interface SelectedRules {
  readonly purl: string | null;
  readonly rules: readonly RegistryV2Rule[];
}

function selectCustom(purlOrName: string, rules: readonly RegistryV2Rule[]): SelectedRules {
  if (purlOrName.toLowerCase().startsWith("pkg:")) {
    const identity = purlIdentity(parsePurl(normalizePurl(purlOrName)));
    return { purl: identity, rules: rules.filter((rule) => purlIdentity(rule.purl) === identity) };
  }
  const ranked = rankProductsForName(purlOrName, productsFromRules(rules));
  const widest = ranked[0];
  if (!widest) return { purl: null, rules: [] };
  const next = ranked[1];
  if (next && widest.rules.length <= next.rules.length) {
    throw new CheckError(
      `Ambiguous product name "${purlOrName}". Matches: ${ranked.map((product) => `"${product.purl}"`).join(", ")}.`,
    );
  }
  return { purl: purlIdentity(widest.purl), rules: widest.rules };
}

function selectRules(purlOrName: string, custom: readonly RegistryV2Rule[] | undefined): SelectedRules {
  if (custom !== undefined) return selectCustom(purlOrName, custom);
  if (purlOrName.toLowerCase().startsWith("pkg:")) {
    const identity = purlIdentity(parsePurl(normalizePurl(purlOrName)));
    return { purl: identity, rules: resolveCandidateRules(purlOrName) };
  }
  try {
    const rules = resolveCandidateRules(purlOrName);
    return { purl: rules[0] ? purlIdentity(rules[0].purl) : null, rules };
  } catch (error) {
    if (error instanceof CheckError && error.message.startsWith("Unknown product ")) {
      return { purl: null, rules: [] };
    }
    throw error;
  }
}

interface BuiltLine {
  readonly line: ReleaseLine;
  readonly lower: string;
  readonly scheme: string;
}

function chooseRule(current: RegistryV2Rule | undefined, candidate: RegistryV2Rule, asOf: string): RegistryV2Rule {
  if (!current) return candidate;
  const byEvent = seriousness(effectiveEvent(candidate, asOf)) - seriousness(effectiveEvent(current, asOf));
  if (byEvent !== 0) return byEvent < 0 ? candidate : current;
  const candidateDate = candidate.deadline ?? "9999-12-31";
  const currentDate = current.deadline ?? "9999-12-31";
  if (candidateDate !== currentDate) return candidateDate < currentDate ? candidate : current;
  return candidate.id < current.id ? candidate : current;
}

function sortBuilt(lines: readonly BuiltLine[]): BuiltLine[] {
  return [...lines].sort((left, right) => {
    if (left.line.id === "*") return -1;
    if (right.line.id === "*") return 1;
    if (left.scheme === right.scheme) return versionScheme(left.scheme).compare(left.lower, right.lower);
    return left.line.id.localeCompare(right.line.id, "en", { numeric: true });
  });
}

function recommend(
  lines: readonly ReleaseLine[],
  asOf: string,
  complete: boolean,
): { recommendation: VersionRecommendation | null; reason: string } {
  const ending = lines.filter((line) => line.status === "ending" && line.endDate !== null);
  if (ending.length === 0) {
    if (lines.length === 0) return { recommendation: null, reason: "Ebb has no release lines for this component." };
    if (lines.every((line) => line.status === "ended")) {
      return { recommendation: null, reason: "Every known release line has already ended." };
    }
    return { recommendation: null, reason: "No known release line has an end date, so Ebb recommends none." };
  }

  const latest = [...ending].sort((left, right) => {
    const byDate = (left.endDate ?? "").localeCompare(right.endDate ?? "");
    if (byDate !== 0) return byDate;
    return lines.indexOf(left) - lines.indexOf(right);
  })[ending.length - 1];
  if (!latest?.endDate) {
    return { recommendation: null, reason: "No known release line has an end date, so Ebb recommends none." };
  }

  if ((daysLeft(latest.endDate, asOf) ?? 0) <= RECOMMEND_AFTER_DAYS) {
    return {
      recommendation: null,
      reason: `The latest known end date is ${latest.endDate} (${latest.id}), which is within ${RECOMMEND_AFTER_DAYS} days, so Ebb recommends no line.`,
    };
  }

  const reason = complete
    ? `${latest.id} has the latest known end date (${latest.endDate}).`
    : `${latest.id} has the latest known end date (${latest.endDate}). The answer is incomplete.`;
  return { recommendation: { lineId: latest.id, reason }, reason };
}

function emptyResult(purl: string | null, asOf: string, note: string): SupportedVersionsResult {
  return {
    purl,
    asOf,
    lines: [],
    recommendation: null,
    reason: "Ebb has no release lines for this component.",
    complete: false,
    notes: [note],
  };
}

function evaluate(
  purlOrName: string,
  asOf: string,
  custom: readonly RegistryV2Rule[] | undefined,
): SupportedVersionsResult {
  const selected = selectRules(purlOrName, custom);
  const releaseRules = selected.rules.filter(isReleaseRule);
  const visible = releaseRules.filter((rule) => rule.provenance.observedAt <= asOf);
  if (visible.length === 0) {
    const note =
      selected.rules.length === 0
        ? "Ebb has no rules for this component."
        : releaseRules.length === 0
          ? "Ebb has rules for this component, but none of them name a release line."
          : "Ebb has no rules for this component as of this date.";
    return emptyResult(selected.purl, asOf, note);
  }

  const byLine = new Map<string, { rule: RegistryV2Rule; lower: string; scheme: string }>();

  for (const rule of visible) {
    const bounds = releaseLineFromVers(rule.vers);
    if (!bounds) continue;
    const current = byLine.get(bounds.id);
    byLine.set(bounds.id, {
      rule: chooseRule(current?.rule, rule, asOf),
      lower: bounds.lower,
      scheme: bounds.scheme,
    });
  }

  const built = sortBuilt(
    [...byLine.entries()].map(([id, chosen]) => {
      const event = effectiveEvent(chosen.rule, asOf);
      const endDate = chosen.rule.deadline ?? null;
      return {
        lower: chosen.lower,
        scheme: chosen.scheme,
        line: {
          id,
          vers: chosen.rule.vers,
          status: lineStatus(event, chosen.rule.deadline, asOf),
          endDate,
          ruleId: chosen.rule.id,
          event,
        },
      };
    }),
  );
  const lines = built.map((entry) => entry.line);
  const { recommendation, reason } = recommend(lines, asOf, false);
  return { purl: selected.purl, asOf, lines, recommendation, reason, complete: false, notes: [] };
}

/**
 * Lists the release lines Ebb can name for a component, and recommends the one whose known
 * end date is furthest ahead when that date is more than {@link RECOMMEND_AFTER_DAYS} days
 * after the reference day. An unknown component is an empty answer, not a supported one.
 * Passing `asOf` does not read the system clock.
 */
export function supportedVersions(purlOrName: string, options?: SupportedVersionsOptions): SupportedVersionsResult {
  const asOf = options?.asOf;
  if (asOf !== undefined) {
    requireIsoDate(asOf);
    return evaluate(purlOrName, asOf, options?.rules);
  }
  return evaluate(purlOrName, utcToday(), options?.rules);
}
