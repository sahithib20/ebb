import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentRecord } from "./components.js";
import type { RuleRecord } from "./rules.js";

export interface EcosystemCollectionItem {
  name: string;
  componentCount: number;
  recordIds: string[];
}

export interface EcosystemsCollection {
  dataVersion: string;
  ecosystems: EcosystemCollectionItem[];
}

export interface UpcomingEventItem {
  date: string;
  event: string;
  ruleId: string;
  componentId: string;
}

export interface UpcomingMonthGroup {
  month: string;
  events: UpcomingEventItem[];
}

export interface UpcomingCollection {
  dataVersion: string;
  months: UpcomingMonthGroup[];
}

export interface ReleaseChangesItem {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  removed: string[];
}

export interface ReleasesCollection {
  dataVersion: string;
  releases: ReleaseChangesItem[];
}

export function generateEcosystemsCollection(
  components: readonly ComponentRecord[],
  dataVersion: string,
): EcosystemsCollection {
  const byEcosystem = new Map<string, string[]>();

  for (const comp of components) {
    if (!byEcosystem.has(comp.ecosystem)) {
      byEcosystem.set(comp.ecosystem, []);
    }
    byEcosystem.get(comp.ecosystem)!.push(comp.id);
  }

  const ecosystems: EcosystemCollectionItem[] = [];
  for (const eco of Array.from(byEcosystem.keys()).sort()) {
    const recordIds = byEcosystem.get(eco)!.sort();
    ecosystems.push({
      name: eco,
      componentCount: recordIds.length,
      recordIds,
    });
  }

  return {
    dataVersion,
    ecosystems,
  };
}

export function generateUpcomingCollection(options: {
  rules: readonly RuleRecord[];
  components: readonly ComponentRecord[];
  dataVersion: string;
  asOf: string;
}): UpcomingCollection {
  const { rules, components, dataVersion, asOf } = options;

  // Build rule -> componentId lookup
  const ruleToComp = new Map<string, string>();
  for (const comp of components) {
    for (const ruleId of comp.rules) {
      ruleToComp.set(ruleId, comp.id);
    }
  }

  // Collect future events with deadline >= asOf (data version date, NOT build date)
  const futureEvents: UpcomingEventItem[] = [];
  for (const rule of rules) {
    const deadline = rule.dates.deadline;
    if (deadline && deadline >= asOf) {
      const compId = ruleToComp.get(rule.id);
      if (compId) {
        futureEvents.push({
          date: deadline,
          event: rule.event,
          ruleId: rule.id,
          componentId: compId,
        });
      }
    }
  }

  // Sort by date ascending, then ruleId
  futureEvents.sort((a, b) => a.date.localeCompare(b.date) || a.ruleId.localeCompare(b.ruleId));

  // Group by YYYY-MM
  const monthMap = new Map<string, UpcomingEventItem[]>();
  for (const ev of futureEvents) {
    const month = ev.date.slice(0, 7);
    if (!monthMap.has(month)) {
      monthMap.set(month, []);
    }
    monthMap.get(month)!.push(ev);
  }

  const months: UpcomingMonthGroup[] = [];
  for (const month of Array.from(monthMap.keys()).sort()) {
    months.push({
      month,
      events: monthMap.get(month)!,
    });
  }

  return {
    dataVersion,
    months,
  };
}

export function parseChangelogReleases(changelogPath: string, existingRuleIds: Set<string>): ReleaseChangesItem[] {
  if (!existsSync(changelogPath)) {
    return [];
  }

  const content = readFileSync(changelogPath, "utf8");
  const releaseBlocks = content.split(/\n(?=##\s+\[)/);
  const releases: ReleaseChangesItem[] = [];

  for (const block of releaseBlocks) {
    const headerMatch = block.match(/^##\s+\[([0-9a-zA-Z.-]+)\]\s+-\s+([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    if (!headerMatch) continue;

    const version = headerMatch[1]!;
    const date = headerMatch[2]!;

    const added: string[] = [];
    const changed: string[] = [];
    const removed: string[] = [];

    // Parse bullet lines like: - **Added** [`npm.package.left-pad.deprecated`](...)
    const lineRegex = /-\s+\*\*(Added|Changed|Removed)\*\*\s+\[`([^`]+)`\]/g;
    let match: RegExpExecArray | null;
    while ((match = lineRegex.exec(block)) !== null) {
      const action = match[1];
      const ruleId = match[2];
      if (!ruleId || !existingRuleIds.has(ruleId)) {
        // Only reference rule IDs that exist in the active dataset
        continue;
      }
      if (action === "Added" && !added.includes(ruleId)) {
        added.push(ruleId);
      } else if (action === "Changed" && !changed.includes(ruleId)) {
        changed.push(ruleId);
      } else if (action === "Removed" && !removed.includes(ruleId)) {
        removed.push(ruleId);
      }
    }

    releases.push({
      version,
      date,
      added: added.sort(),
      changed: changed.sort(),
      removed: removed.sort(),
    });
  }

  return releases;
}

export function generateReleasesCollection(options: {
  root: string;
  dataVersion: string;
  existingRuleIds: Set<string>;
}): ReleasesCollection {
  const changelogPath = join(options.root, "DATA-CHANGELOG.md");
  const releases = parseChangelogReleases(changelogPath, options.existingRuleIds);

  return {
    dataVersion: options.dataVersion,
    releases,
  };
}
