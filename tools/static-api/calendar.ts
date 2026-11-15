/**
 * Static iCalendar feeds. One file for everything, one per ecosystem, and one per
 * component that still has a deadline on or after the data date.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { purlToApiPath } from "../../src/api.js";
import { toICal } from "../../src/export/ical.js";
import { purlIdentity } from "../../src/purl.js";
import type { RegistryV2Rule } from "../../src/registry.js";
import { addDays, addMonths, upcoming } from "../../src/upcoming.js";

/** Events older than this stay out of the aggregate feeds. */
export const CALENDAR_LOOKBACK_DAYS = 30;
/** How far ahead the aggregate feeds look, measured from the data date. */
export const CALENDAR_AHEAD_MONTHS = 24;

export interface WriteCalendarsOptions {
  outDir: string;
  rules: readonly RegistryV2Rule[];
  ecosystems: readonly string[];
  baseUrl: string;
  /** Data timestamp. Its calendar day is the feed's reference date and every DTSTAMP. */
  stamp: string;
}

export function calendarFeedPath(purl: string): string {
  return `calendar/${purlToApiPath(purl).replace(/\.json$/, ".ics")}`;
}

function referenceDay(stamp: string): string {
  return stamp.slice(0, 10);
}

function aggregateWindow(reference: string): { asOf: string; within: number } {
  const asOf = addDays(reference, -CALENDAR_LOOKBACK_DAYS);
  const until = addMonths(reference, CALENDAR_AHEAD_MONTHS);
  const within = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);
  return { asOf, within };
}

async function writeFeed(outDir: string, relativePath: string, body: string): Promise<void> {
  const file = join(outDir, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body, "utf8");
}

/**
 * Writes the `.ics` feeds under `outDir/calendar/` and returns the public feed URL
 * for each component that has a deadline on or after the data date.
 */
export async function writeCalendars(options: WriteCalendarsOptions): Promise<Map<string, string>> {
  const reference = referenceDay(options.stamp);
  const window = aggregateWindow(reference);
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const shared = {
    rules: options.rules,
    stamp: options.stamp,
    baseUrl,
  };

  await writeFeed(options.outDir, "calendar/all.ics", toICal({ ...shared, ...window, name: "Ebb" }));

  const ecosystems = [...options.ecosystems].sort();
  for (const ecosystem of ecosystems) {
    await writeFeed(
      options.outDir,
      `calendar/${ecosystem}.ics`,
      toICal({ ...shared, ...window, ecosystem, name: `Ebb ${ecosystem}` }),
    );
  }

  const byComponent = new Map<string, RegistryV2Rule[]>();
  for (const rule of options.rules) {
    const identity = purlIdentity(rule.purl);
    const group = byComponent.get(identity) ?? [];
    group.push(rule);
    byComponent.set(identity, group);
  }

  const feeds = new Map<string, string>();
  const identities = [...byComponent.keys()].sort();
  for (const identity of identities) {
    const rules = byComponent.get(identity) ?? [];
    const future = upcoming({ rules, asOf: reference, within: "100y" });
    if (future.count === 0) continue;
    const relativePath = calendarFeedPath(identity);
    await writeFeed(
      options.outDir,
      relativePath,
      toICal({
        rules,
        asOf: reference,
        within: "100y",
        stamp: options.stamp,
        baseUrl,
        purl: identity,
        name: `Ebb ${identity}`,
      }),
    );
    feeds.set(identity, `${baseUrl}/${relativePath}`);
  }
  return feeds;
}
