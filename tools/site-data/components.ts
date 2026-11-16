import { parsePurl } from "../../src/purl.js";
import type { RegistryV2Rule } from "../../src/registry.js";
import { deriveComponentSlug, type SlugTracker } from "./slug.js";
import { buildComponentText } from "./text.js";

export interface ComponentLinks {
  rules: string[];
  lines: string[];
  apiUrl: string;
  sourcePath: string;
}

export interface ComponentDates {
  earliestDeadline?: string | null | undefined;
  latestReview?: string | null | undefined;
  observedAt?: string | null | undefined;
}

export interface NextEvent {
  event: string;
  date: string;
}

export interface ComponentRecord {
  id: string;
  recordType: "component";
  slug: string;
  name: string;
  ecosystem: string;
  purl: string;
  title: string;
  summary: string;
  status: string;
  dates: ComponentDates;
  nextEvent: NextEvent | null;
  rules: string[];
  links: ComponentLinks;
}

export function determineComponentStatus(rules: readonly RegistryV2Rule[], asOf: string): string {
  // Check for whole-package deprecation
  const starDeprecated = rules.some(
    (r) => (r.vers === "*" || r.vers === "vers:*") && (r.event === "deprecated" || r.event === "end-of-life"),
  );
  if (starDeprecated) {
    const depRule = rules.find(
      (r) => (r.vers === "*" || r.vers === "vers:*") && (r.event === "deprecated" || r.event === "end-of-life"),
    );
    return depRule?.event ?? "deprecated";
  }

  // Check for past end-of-life
  const eolPast = rules.some((r) => r.event === "end-of-life" && (!r.deadline || r.deadline <= asOf));
  if (eolPast) {
    return "end-of-life";
  }

  // Check for removed
  const removed = rules.some((r) => r.event === "removed");
  if (removed) {
    return "removed";
  }

  // Check for general deprecation
  const deprecated = rules.some((r) => r.event === "deprecated");
  if (deprecated) {
    return "deprecated";
  }

  // Check for scheduled event
  const scheduled = rules.some((r) => r.event === "scheduled-end-of-life" && (!r.deadline || r.deadline > asOf));
  if (scheduled) {
    return "scheduled";
  }

  return "active";
}

export function generateComponentRecord(options: {
  purl: string;
  ecosystem: string;
  rules: readonly RegistryV2Rule[];
  asOf: string;
  slugTracker: SlugTracker;
}): ComponentRecord {
  const { purl, ecosystem, rules, asOf, slugTracker } = options;

  const parsed = purl.startsWith("pkg:") ? parsePurl(purl) : null;
  const name = parsed?.name ?? purl.split("/").pop() ?? purl;

  const baseSlug = deriveComponentSlug(ecosystem, parsed?.namespace ? `${parsed.namespace}/${name}` : name);
  const slug = slugTracker.allocate(purl, baseSlug);

  const status = determineComponentStatus(rules, asOf);

  // Next event: earliest future deadline >= asOf
  const upcomingDeadlines = rules
    .filter((r) => r.deadline !== undefined && r.deadline >= asOf)
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!));

  const nextEvent: NextEvent | null =
    upcomingDeadlines.length > 0 ? { event: upcomingDeadlines[0]!.event, date: upcomingDeadlines[0]!.deadline! } : null;

  // Dates
  const allDeadlines = rules.map((r) => r.deadline).filter((d): d is string => Boolean(d));
  const earliestDeadline = allDeadlines.length > 0 ? allDeadlines.sort()[0] : null;

  const allReviews = rules
    .map((r) => r.provenance?.reviewedAt ?? r.provenance?.observedAt)
    .filter((d): d is string => Boolean(d));
  const latestReview = allReviews.length > 0 ? allReviews.sort().slice(-1)[0] : null;

  const allObserved = rules.map((r) => r.provenance?.observedAt).filter((d): d is string => Boolean(d));
  const observedAt = allObserved.length > 0 ? allObserved.sort()[0] : null;

  const dates: ComponentDates = {
    ...(earliestDeadline ? { earliestDeadline } : {}),
    ...(latestReview ? { latestReview } : {}),
    ...(observedAt ? { observedAt } : {}),
  };

  const { title, summary } = buildComponentText({
    name,
    ecosystem,
    status,
    ruleCount: rules.length,
    nextEvent,
  });

  const ruleIds = rules.map((r) => r.id).sort();

  return {
    id: purl,
    recordType: "component",
    slug,
    name,
    ecosystem,
    purl,
    title,
    summary,
    status,
    dates,
    nextEvent,
    rules: ruleIds,
    links: {
      rules: [], // resolved in links.ts
      lines: [], // resolved in links.ts
      apiUrl: "", // resolved in links.ts
      sourcePath: `registry/${ecosystem}.json`,
    },
  };
}
