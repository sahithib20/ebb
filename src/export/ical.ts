/**
 * `toICal(options?)` renders lifecycle deadlines as one RFC 5545 calendar.
 * The text uses CRLF, escaped text values, and lines of at most 75 octets.
 * Nothing here reads the clock: the stamp and the window come from the data.
 */

import { DEFAULT_STATIC_API_BASE_URL, purlToApiPath } from "../api.js";
import { BUNDLED_ECOSYSTEMS } from "../data/ecosystems.js";
import { loadEcosystemSync } from "../data/load.js";
import { isCalendarSequence, isIsoDate, type RegistryV2Rule } from "../registry.js";
import { addDays, upcoming, type UpcomingItem } from "../upcoming.js";

const UID_DOMAIN = "velella.sh";
const OCTET_LIMIT = 75;

export interface ToICalOptions {
  /** Ecosystem name or names. Uses the same filter as `upcoming`. */
  readonly ecosystem?: string | readonly string[] | undefined;
  /** Component PURL or PURLs. A version keeps only rules whose range contains it. */
  readonly purl?: string | readonly string[] | undefined;
  /** Window span, as `upcoming` accepts it (`30d`, `2w`, `3m`, `1y`, or a number of days). */
  readonly within?: string | number | undefined;
  /** First day of the window (`YYYY-MM-DD`). Defaults to the latest review date in the data. */
  readonly asOf?: string | undefined;
  /** Rules to render. Defaults to the active bundled registries. */
  readonly rules?: readonly RegistryV2Rule[] | undefined;
  /**
   * `DTSTAMP` source: a calendar day or an ISO timestamp from the data version.
   * Defaults to the latest review date. The clock is not consulted.
   */
  readonly stamp?: string | undefined;
  /** Calendar name. Defaults to one that names the ecosystem, PURL, and window. */
  readonly name?: string | undefined;
  /** Base URL of the static API, used for each event's component page. */
  readonly baseUrl?: string | undefined;
}

function asList(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((item) => item.trim()).filter(Boolean);
}

function collectRules(options: ToICalOptions): readonly RegistryV2Rule[] {
  if (options.rules) return options.rules;
  const wanted = new Set(asList(options.ecosystem).map((name) => name.toLowerCase()));
  const names = wanted.size > 0 ? BUNDLED_ECOSYSTEMS.filter((name) => wanted.has(name)) : BUNDLED_ECOSYSTEMS;
  const rules: RegistryV2Rule[] = [];
  for (const name of names) rules.push(...loadEcosystemSync(name));
  return rules;
}

export function latestReview(rules: readonly RegistryV2Rule[]): string {
  let latest = "1970-01-01";
  for (const rule of rules) {
    const reviewed = rule.provenance?.reviewedAt;
    if (reviewed && reviewed > latest) latest = reviewed;
  }
  return latest;
}

function calendarName(options: ToICalOptions, span: string): string {
  if (options.name) return options.name;
  const parts = ["Ebb", ...asList(options.ecosystem), ...asList(options.purl), `(${span})`];
  return parts.join(" ");
}

/** Escape a TEXT value: backslash, newline, semicolon, comma. */
export function escapeICalText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

/**
 * Fold one content line at 75 octets. Continuation lines start with a space,
 * and that space counts toward the 75. UTF-8 characters and `\` escapes stay whole.
 */
export function foldICalLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= OCTET_LIMIT) return line;
  const parts: string[] = [];
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  let start = 0;
  let budget = OCTET_LIMIT;
  while (start < bytes.length) {
    let end = Math.min(bytes.length, start + budget);
    if (end < bytes.length) {
      while (end > start && (bytes[end]! & 0xc0) === 0x80) end--;
      if (end > start && bytes[end - 1] === 0x5c) end--;
      if (end === start) end = Math.min(bytes.length, start + budget);
    }
    parts.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
    budget = OCTET_LIMIT - 1;
  }
  return parts.join("\r\n ");
}

function normalizeStamp(value: string): string {
  const day = value.slice(0, 10);
  if (value.length === 10 && isIsoDate(day)) return `${day}T00:00:00.000Z`;
  if (
    !isIsoDate(day) ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new RangeError("Expected a calendar day or an ISO timestamp with a timezone for stamp.");
  }
  const normalized = new Date(value).toISOString();
  if (!isIsoDate(normalized.slice(0, 10))) throw new RangeError("Stamp is outside the supported calendar date range.");
  return normalized;
}

function formatDay(day: string): string {
  return day.replaceAll("-", "");
}

function calendarSequence(rule?: RegistryV2Rule): number {
  const sequence = rule?.["x-ical"]?.sequence;
  return isCalendarSequence(sequence) ? sequence : 0;
}

function eventDescription(rule: RegistryV2Rule | undefined, item: UpcomingItem): string {
  const parts: string[] = [];
  if (rule?.summary) parts.push(rule.summary);
  if (item.replacement) parts.push(`Replacement: ${item.replacement}`);
  const source = item.sources[0]?.url;
  if (source) parts.push(source);
  return parts.join("\n");
}

function componentPage(baseUrl: string, purl: string): string {
  const base = new URL(baseUrl);
  const basePath = base.pathname;
  let end = basePath.length;
  while (end > 0 && basePath[end - 1] === "/") end--;
  const path = purlToApiPath(purl).split("/").map(encodeURIComponent).join("/");
  base.pathname = `${basePath.slice(0, end)}/${path}`;
  return base.href;
}

function contentLine(name: string, value: string): string {
  return foldICalLine(`${name}:${escapeICalText(value)}`);
}

/**
 * One calendar of the deadlines `upcoming` would return for these filters.
 * Events are all-day, ordered by deadline then rule id. The same data yields the same bytes.
 */
export function toICal(options: ToICalOptions = {}): string {
  const rules = collectRules(options);
  const dataStamp = normalizeStamp(options.stamp ?? latestReview(rules));
  const asOf = options.asOf ?? dataStamp.slice(0, 10);
  const result = upcoming({
    rules,
    asOf,
    within: options.within,
    ecosystem: options.ecosystem,
    purls: asList(options.purl),
  });
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const items = result.items.sort((a, b) => {
    if (a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
    return a.ruleId === b.ruleId ? 0 : a.ruleId < b.ruleId ? -1 : 1;
  });
  const stamp = `${dataStamp.slice(0, 19).replaceAll("-", "").replaceAll(":", "")}Z`;
  const baseUrl = options.baseUrl ?? DEFAULT_STATIC_API_BASE_URL;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Velella//Ebb//EN",
    "CALSCALE:GREGORIAN",
    contentLine("NAME", calendarName(options, result.within)),
    contentLine("X-WR-CALNAME", calendarName(options, result.within)),
  ];
  for (const item of items) {
    const rule = byId.get(item.ruleId);
    lines.push(
      "BEGIN:VEVENT",
      contentLine("UID", `${item.ruleId}@${UID_DOMAIN}`),
      `SEQUENCE:${calendarSequence(rule)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${formatDay(item.deadline)}`,
      `DTEND;VALUE=DATE:${formatDay(addDays(item.deadline, 1))}`,
      contentLine("SUMMARY", item.title),
      contentLine("DESCRIPTION", eventDescription(rule, item)),
      foldICalLine(`URL:${componentPage(baseUrl, item.purl)}`),
      contentLine("CATEGORIES", item.event),
      "END:VEVENT",
    );
  }
  // RFC 5545 requires a component. A VFREEBUSY with no busy periods represents a feed with no deadlines.
  if (items.length === 0) {
    lines.push("BEGIN:VFREEBUSY", `DTSTAMP:${stamp}`, "UID:empty@velella.sh", "END:VFREEBUSY");
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
