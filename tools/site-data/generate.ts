import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { DEFAULT_STATIC_API_BASE_URL } from "../../src/api.js";
import { purlIdentity } from "../../src/purl.js";
import type { RegistryV2, RegistryV2Rule } from "../../src/registry.js";
import { generateEcosystemsCollection, generateReleasesCollection, generateUpcomingCollection } from "./collections.js";
import { generateComponentRecord, type ComponentRecord } from "./components.js";
import { generateLineRecordsForComponent, type ReleaseLineRecord } from "./lines.js";
import { resolveLinks } from "./links.js";
import { generateRuleRecords } from "./rules.js";
import { SlugTracker } from "./slug.js";

export interface GenerateSiteDataOptions {
  root?: string | undefined;
  outDir?: string | undefined;
  baseUrl?: string | undefined;
  dataVersion?: string | undefined;
  slugLockPath?: string | undefined;
  updateLock?: boolean | undefined;
  rules?: readonly RegistryV2Rule[] | undefined;
}

export interface GenerateSiteDataResult {
  outDir: string;
  dataVersion: string;
  componentCount: number;
  ruleCount: number;
  lineCount: number;
  ecosystemCount: number;
  totalBytes: number;
  totalGzipBytes: number;
  files: string[];
}

/** Recursively sorts object keys alphabetically to guarantee deterministic JSON output. */
export function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(sortKeys) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted as T;
  }
  return value;
}

export async function generateSiteData(options: GenerateSiteDataOptions = {}): Promise<GenerateSiteDataResult> {
  const root = resolve(options.root ?? process.cwd());
  const outDir = resolve(options.outDir ?? "dist/site-data");
  const baseUrl = options.baseUrl ?? DEFAULT_STATIC_API_BASE_URL;
  const slugLockPath = options.slugLockPath ?? join(root, "tools/site-data/slugs.lock.json");

  // 1. Read all rules directly from registry/ files unless explicitly passed
  let allRules: RegistryV2Rule[] = [];
  const ruleEcosystemMap = new Map<string, string>();
  const componentsByPurl = new Map<string, { purl: string; ecosystem: string; rules: RegistryV2Rule[] }>();

  if (options.rules) {
    allRules = [...options.rules];
    for (const rule of allRules) {
      ruleEcosystemMap.set(rule.id, rule.ecosystem);
      const identity = purlIdentity(rule.purl);
      let comp = componentsByPurl.get(identity);
      if (!comp) {
        comp = { purl: identity, ecosystem: rule.ecosystem, rules: [] };
        componentsByPurl.set(identity, comp);
      }
      comp.rules.push(rule);
    }
  } else {
    const registryDir = join(root, "registry");
    const entries = await readdir(registryDir);
    const registryFiles = entries
      .filter((f) => f.endsWith(".json") && !f.includes("sources.lock") && !f.includes("github-actions-shas"))
      .sort();

    for (const file of registryFiles) {
      const raw = await readFile(join(registryDir, file), "utf8");
      const reg = JSON.parse(raw) as RegistryV2;
      const ecosystem = reg.ecosystem ?? file.replace(".json", "");

      for (const rule of reg.rules) {
        allRules.push(rule);
        ruleEcosystemMap.set(rule.id, ecosystem);

        const identity = purlIdentity(rule.purl);
        let comp = componentsByPurl.get(identity);
        if (!comp) {
          comp = { purl: identity, ecosystem, rules: [] };
          componentsByPurl.set(identity, comp);
        }
        comp.rules.push(rule);
      }
    }
  }

  // 2. Take all dates from the data, not the clock
  let maxDataDate = "1970-01-01";
  for (const rule of allRules) {
    const d = rule.provenance?.reviewedAt ?? rule.provenance?.observedAt;
    if (d && d > maxDataDate) {
      maxDataDate = d;
    }
  }
  const asOf = maxDataDate;
  const dataVersion = options.dataVersion ?? maxDataDate.replace(/-/g, ".");

  // 3. Initialize SlugTracker from lock file
  const slugTracker = SlugTracker.fromFile(slugLockPath);

  // 4. Generate Rule Records
  const ruleRecordsMap = generateRuleRecords(allRules, slugTracker);

  // 5. Generate Component Records
  const componentRecordsMap = new Map<string, ComponentRecord>();
  const sortedCompEntries = Array.from(componentsByPurl.entries()).sort(([a], [b]) => a.localeCompare(b));

  for (const [purl, compData] of sortedCompEntries) {
    const compRecord = generateComponentRecord({
      purl,
      ecosystem: compData.ecosystem,
      rules: compData.rules,
      asOf,
      slugTracker,
    });
    componentRecordsMap.set(purl, compRecord);
  }

  // 6. Generate Release Line Records
  const allLineRecords: ReleaseLineRecord[] = [];
  for (const [purl, compData] of sortedCompEntries) {
    const compRecord = componentRecordsMap.get(purl)!;
    const lines = generateLineRecordsForComponent({
      purl,
      name: compRecord.name,
      componentSlug: compRecord.slug,
      ecosystem: compRecord.ecosystem,
      rules: compData.rules,
      asOf,
      slugTracker,
    });
    allLineRecords.push(...lines);
  }

  // 7. Resolve links between records
  resolveLinks(componentRecordsMap, ruleRecordsMap, allLineRecords, ruleEcosystemMap, { baseUrl });

  // 8. Generate collection files
  const sortedComponents = Array.from(componentRecordsMap.values()).sort((a, b) => a.slug.localeCompare(b.slug));
  const sortedRules = Array.from(ruleRecordsMap.values()).sort((a, b) => a.slug.localeCompare(b.slug));
  const sortedLines = [...allLineRecords].sort((a, b) => a.slug.localeCompare(b.slug));

  const ecosystemsColl = generateEcosystemsCollection(sortedComponents, dataVersion);
  const upcomingColl = generateUpcomingCollection({
    rules: sortedRules,
    components: sortedComponents,
    dataVersion,
    asOf,
  });
  const releasesColl = generateReleasesCollection({
    root,
    dataVersion,
    existingRuleIds: new Set(allRules.map((r) => r.id)),
  });

  const redirects = slugTracker.getRedirects();

  // 9. Write files to outDir
  await mkdir(outDir, { recursive: true });
  await mkdir(join(outDir, "components"), { recursive: true });
  await mkdir(join(outDir, "rules"), { recursive: true });
  await mkdir(join(outDir, "lines"), { recursive: true });

  const writtenFiles: string[] = [];
  let totalBytes = 0;
  let totalGzipBytes = 0;

  async function writeJsonFile(relPath: string, data: unknown): Promise<void> {
    const fullPath = join(outDir, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    const content = JSON.stringify(sortKeys(data), null, 2) + "\n";
    await writeFile(fullPath, content, "utf8");
    writtenFiles.push(relPath);

    const buf = Buffer.from(content, "utf8");
    totalBytes += buf.length;
    totalGzipBytes += gzipSync(buf).length;
  }

  // Individual component records
  for (const comp of sortedComponents) {
    await writeJsonFile(`components/${comp.slug}.json`, comp);
  }

  // Individual rule records
  for (const rule of sortedRules) {
    await writeJsonFile(`rules/${rule.slug}.json`, rule);
  }

  // Individual release line records
  for (const line of sortedLines) {
    await writeJsonFile(`lines/${line.slug}.json`, line);
  }

  // Collection files
  await writeJsonFile("components.json", {
    dataVersion,
    type: "component",
    records: sortedComponents,
  });

  await writeJsonFile("rules.json", {
    dataVersion,
    type: "rule",
    records: sortedRules,
  });

  await writeJsonFile("lines.json", {
    dataVersion,
    type: "release-line",
    records: sortedLines,
  });

  await writeJsonFile("ecosystems.json", ecosystemsColl);
  await writeJsonFile("upcoming.json", upcomingColl);
  await writeJsonFile("releases.json", releasesColl);
  await writeJsonFile("redirects.json", redirects);

  // Index / manifest file
  const indexDoc = {
    dataVersion,
    generatedAt: `${asOf}T00:00:00.000Z`,
    componentCount: sortedComponents.length,
    ruleCount: sortedRules.length,
    lineCount: sortedLines.length,
    ecosystemCount: ecosystemsColl.ecosystems.length,
    files: writtenFiles.sort(),
  };
  await writeJsonFile("index.json", indexDoc);

  // Save lock file if requested or if missing
  if (options.updateLock || !existsSync(slugLockPath)) {
    slugTracker.saveToFile(slugLockPath);
  }

  return {
    outDir,
    dataVersion,
    componentCount: sortedComponents.length,
    ruleCount: sortedRules.length,
    lineCount: sortedLines.length,
    ecosystemCount: ecosystemsColl.ecosystems.length,
    totalBytes,
    totalGzipBytes,
    files: writtenFiles.sort(),
  };
}
