import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { DEFAULT_MAX_REVIEW_AGE_DAYS, type RegistryV2 } from "../src/registry.js";
import { stale, staleBadgeEndpoint } from "../src/stale.js";

export interface EndpointBadge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
}

export const STATUS_COUNTS_START = "<!-- ebb-source-status-counts:start -->";
export const STATUS_COUNTS_END = "<!-- ebb-source-status-counts:end -->";

export function renderStatusCountsTable(counts: Record<string, number>): string {
  const rows = [
    "| Status | Count | Description |",
    "|---|---|---|",
    `| \`ok\` | ${counts.ok ?? 0} | Reachable and verified unchanged |`,
    `| \`archived-only\` | ${counts["archived-only"] ?? 0} | Unreachable primary, verified via archive snapshot |`,
    `| \`changed\` | ${counts.changed ?? 0} | Title or URL redirected |`,
    `| \`date-changed\` | ${counts["date-changed"] ?? 0} | Structured pointer value differs from rule date |`,
    `| \`date-missing\` | ${counts["date-missing"] ?? 0} | Stated deadline not found in source text |`,
    `| \`unreachable\` | ${counts.unreachable ?? 0} | HTTP error or connection timeout |`,
    `| \`blocked\` | ${counts.blocked ?? 0} | Anti-bot challenge or unverified response |`,
    `| \`unrecorded\` | ${counts.unrecorded ?? 0} | Cited in a rule but not yet locked |`,
    `| \`stale\` | ${counts.stale ?? 0} | Past human review freshness window |`,
  ];
  return rows.join("\n");
}

export async function updateFreshnessDoc(docPath: string, counts: Record<string, number>): Promise<boolean> {
  try {
    const content = await readFile(docPath, "utf-8");
    const startIndex = content.indexOf(STATUS_COUNTS_START);
    const endIndex = content.indexOf(STATUS_COUNTS_END);
    if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
      return false;
    }
    const table = renderStatusCountsTable(counts);
    const updated = `${content.slice(0, startIndex + STATUS_COUNTS_START.length)}\n${table}\n${content.slice(endIndex)}`;
    await writeFile(docPath, updated, "utf-8");
    return true;
  } catch {
    return false;
  }
}

export async function generateDataBadges(
  registryDir: string = "registry",
  outputDir: string = "coverage",
  asOf: string = new Date().toISOString().slice(0, 10),
  freshnessDocPath: string = "docs/freshness.md",
  reportPath?: string,
): Promise<{
  totalRules: number;
  staleRules: number;
  fileCount: number;
  verifiedSources: number;
  statusCounts: Record<string, number>;
}> {
  const files = (await readdir(registryDir)).filter((f) => f.endsWith(".json") && f !== "sources.lock.json");
  const registries: RegistryV2[] = [];
  let totalRules = 0;

  for (const file of files) {
    try {
      const content = await readFile(join(registryDir, file), "utf-8");
      const parsed = JSON.parse(content) as RegistryV2;
      if (Array.isArray(parsed.rules)) {
        totalRules += parsed.rules.length;
        registries.push(parsed);
      }
    } catch {
      // Ignore non-registry JSON
    }
  }

  await mkdir(outputDir, { recursive: true });

  const rulesBadge: EndpointBadge = {
    schemaVersion: 1,
    label: "rules",
    message: `${totalRules}`,
    color: "3F6E66",
  };
  await writeFile(join(outputDir, "rules.json"), `${JSON.stringify(rulesBadge, null, 2)}\n`);

  const staleResult = stale({ asOf, registries });
  const staleBadge = staleBadgeEndpoint(staleResult);
  await writeFile(join(outputDir, "stale-rules.json"), `${JSON.stringify(staleBadge, null, 2)}\n`);

  let verifiedSources = 0;
  const statusCounts: Record<string, number> = {
    ok: 0,
    "archived-only": 0,
    changed: 0,
    "date-changed": 0,
    "date-missing": 0,
    unreachable: 0,
    blocked: 0,
    unrecorded: 0,
    stale: staleResult.counts.stale,
  };

  let reportLoaded = false;
  if (reportPath) {
    try {
      const reportContent = await readFile(reportPath, "utf-8");
      const report = JSON.parse(reportContent);
      statusCounts.ok = typeof report.ok === "number" ? report.ok : 0;
      statusCounts["archived-only"] = Array.isArray(report["archived-only"]) ? report["archived-only"].length : 0;
      statusCounts.changed = Array.isArray(report.changed) ? report.changed.length : 0;
      statusCounts["date-changed"] = Array.isArray(report["date-changed"]) ? report["date-changed"].length : 0;
      statusCounts["date-missing"] = Array.isArray(report["date-missing"]) ? report["date-missing"].length : 0;
      statusCounts.unreachable = Array.isArray(report.unreachable) ? report.unreachable.length : 0;
      statusCounts.blocked = Array.isArray(report.blocked) ? report.blocked.length : 0;
      statusCounts.unrecorded = Array.isArray(report.unrecorded) ? report.unrecorded.length : 0;
      if (Array.isArray(report.stale)) {
        statusCounts.stale = report.stale.length;
      }
      verifiedSources = statusCounts.ok ?? 0;
      reportLoaded = true;
    } catch {
      // report not readable
    }
  }

  if (!reportLoaded) {
    try {
      const lockContent = await readFile(join(registryDir, "sources.lock.json"), "utf-8");
      const lock = JSON.parse(lockContent) as { sources?: Record<string, { status?: string }> };
      const lockSources = lock.sources ?? {};
      const lockedUrls = new Set<string>();
      for (const [url, entry] of Object.entries(lockSources)) {
        lockedUrls.add(url);
        const status = entry.status ?? "ok";
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      }
      verifiedSources = statusCounts.ok ?? 0;

      const unrecordedUrls = new Set<string>();
      for (const reg of registries) {
        for (const rule of reg.rules) {
          for (const s of rule.sources ?? []) {
            if (!lockedUrls.has(s.url)) {
              unrecordedUrls.add(s.url);
            }
          }
        }
      }
      statusCounts.unrecorded = unrecordedUrls.size;
    } catch {
      // lock file missing
    }
  }

  const verifiedBadge: EndpointBadge = {
    schemaVersion: 1,
    label: "sources verified",
    message: `${verifiedSources}`,
    color: "3F6E66",
  };
  await writeFile(join(outputDir, "sources-verified.json"), `${JSON.stringify(verifiedBadge, null, 2)}\n`);

  await updateFreshnessDoc(freshnessDocPath, statusCounts);

  console.log(`Generated rules badge: ${totalRules} rules from ${files.length} files.`);
  console.log(
    `Generated stale-rules badge: ${staleResult.counts.stale} stale (default window ${DEFAULT_MAX_REVIEW_AGE_DAYS}d or per-registry).`,
  );
  console.log(`Generated sources-verified badge: ${verifiedSources} verified sources.`);

  return {
    totalRules,
    staleRules: staleResult.counts.stale,
    fileCount: files.length,
    verifiedSources,
    statusCounts,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateDataBadges().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
