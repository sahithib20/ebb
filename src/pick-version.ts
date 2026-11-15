/**
 * `supportedVersions`: which release lines Ebb knows, and which one it would take.
 * A line is named only when a rule's VERS range is exactly one release step. Ebb does not
 * invent lines it has no rule for, and it does not call a line supported.
 *
 * This module is the typed signature. It is not exported from the package root yet.
 */

import { EbbError } from "./errors.js";
import { isIsoDate } from "./registry.js";
import type { LifecycleEvent, RegistryV2Rule } from "./registry.js";

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

/**
 * Typed entry point for the release-line query. Line derivation, recommendation, and the
 * package-root export land with the issues that follow this signature.
 */
export function supportedVersions(purlOrName: string, options?: SupportedVersionsOptions): SupportedVersionsResult {
  if (options?.asOf !== undefined) requireIsoDate(options.asOf);
  return {
    purl: purlOrName.toLowerCase().startsWith("pkg:") ? purlOrName : null,
    asOf: options?.asOf ?? utcToday(),
    lines: [],
    recommendation: null,
    reason: "Ebb has no release lines for this component.",
    complete: false,
    notes: ["Ebb has no rules for this component."],
  };
}
