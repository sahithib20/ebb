import { supportedVersions } from "../../src/pick-version.js";
import type { RegistryV2Rule } from "../../src/registry.js";
import { deriveLineSlug, type SlugTracker } from "./slug.js";
import { buildLineText } from "./text.js";

export interface LineLinks {
  component: string;
  rule: string;
  apiUrl: string;
  sourcePath: string;
}

export interface LineDates {
  endDate?: string | null | undefined;
}

export interface ReleaseLineRecord {
  id: string;
  recordType: "release-line";
  slug: string;
  title: string;
  summary: string;
  status: "ended" | "ending" | "no-known-end";
  endDate: string | null;
  dates: LineDates;
  line: string;
  vers: string;
  ruleId: string;
  incomplete?: boolean | undefined;
  links: LineLinks;
}

export function generateLineRecordsForComponent(options: {
  purl: string;
  name: string;
  componentSlug: string;
  ecosystem: string;
  rules: readonly RegistryV2Rule[];
  asOf: string;
  slugTracker: SlugTracker;
}): ReleaseLineRecord[] {
  const { purl, name, componentSlug, ecosystem, rules, asOf, slugTracker } = options;

  // Derive release lines strictly from the version picking function
  const versionResult = supportedVersions(purl, {
    asOf,
    rules,
  });

  const records: ReleaseLineRecord[] = [];
  const incomplete = !versionResult.complete;

  for (const line of versionResult.lines) {
    const recordId = `${purl}#${line.id}`;
    const baseSlug = deriveLineSlug(componentSlug, line.id);
    const slug = slugTracker.allocate(recordId, baseSlug);

    const { title, summary } = buildLineText({
      lineId: line.id,
      compName: name,
      status: line.status,
      endDate: line.endDate,
    });

    const dates: LineDates = {
      endDate: line.endDate,
    };

    const record: ReleaseLineRecord = {
      id: recordId,
      recordType: "release-line",
      slug,
      title,
      summary,
      status: line.status,
      endDate: line.endDate,
      dates,
      line: line.id,
      vers: line.vers,
      ruleId: line.ruleId,
      ...(incomplete ? { incomplete: true } : {}),
      links: {
        component: componentSlug,
        rule: "", // resolved in links.ts
        apiUrl: "",
        sourcePath: `registry/${ecosystem}.json`,
      },
    };

    records.push(record);
  }

  return records;
}
