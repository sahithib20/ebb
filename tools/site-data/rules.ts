import type { EvidenceSource, MigrationGuidance } from "../../src/domain.js";
import type { RegistryV2Rule } from "../../src/registry.js";
import { deriveRuleSlug, type SlugTracker } from "./slug.js";
import { buildRuleText } from "./text.js";

export interface RuleLinks {
  component: string;
  replacementComponent?: string | undefined;
  apiUrl: string;
  sourcePath: string;
}

export interface RuleDates {
  deadline?: string | null | undefined;
  announced?: string | null | undefined;
  observedAt?: string | null | undefined;
  reviewedAt?: string | null | undefined;
}

export interface RuleRecord {
  id: string;
  recordType: "rule";
  slug: string;
  title: string;
  summary: string;
  status: string;
  event: string;
  date?: string | null | undefined;
  dates: RuleDates;
  affectedRange: string;
  replacement?: string | undefined;
  migration?: string | undefined;
  severity?: string | undefined;
  confidence?: string | undefined;
  sources: EvidenceSource[];
  reviewDate: string;
  links: RuleLinks;
}

/**
 * Format migration guidance object into clean Markdown without modifying or shortening any text.
 */
export function migrationToMarkdown(guidance: MigrationGuidance): string {
  const sections: string[] = [];

  if (guidance.constraints && guidance.constraints.length > 0) {
    sections.push("### Constraints\n" + guidance.constraints.map((c) => `- ${c}`).join("\n"));
  }

  if (guidance.steps && guidance.steps.length > 0) {
    sections.push(
      "### Steps\n" + guidance.steps.map((s, idx) => `${idx + 1}. **${s.title}**: ${s.instructions}`).join("\n"),
    );
  }

  if (guidance.verification && guidance.verification.length > 0) {
    sections.push(
      "### Verification\n" + guidance.verification.map((v) => `- \`${v.command}\`: ${v.purpose}`).join("\n"),
    );
  }

  return sections.join("\n\n");
}

export function generateRuleRecords(
  rules: readonly RegistryV2Rule[],
  slugTracker: SlugTracker,
): Map<string, RuleRecord> {
  const records = new Map<string, RuleRecord>();

  for (const rule of rules) {
    const baseSlug = deriveRuleSlug(rule.id);
    const slug = slugTracker.allocate(rule.id, baseSlug);

    const { title, summary } = buildRuleText({
      id: rule.id,
      purl: rule.purl,
      event: rule.event,
      vers: rule.vers,
      deadline: rule.deadline,
      replacement: rule.replacement,
    });

    const announced = (rule as { announced?: string }).announced;
    const dates: RuleDates = {
      ...(rule.deadline ? { deadline: rule.deadline } : {}),
      ...(announced ? { announced } : {}),
      ...(rule.provenance?.observedAt ? { observedAt: rule.provenance.observedAt } : {}),
      ...(rule.provenance?.reviewedAt ? { reviewedAt: rule.provenance.reviewedAt } : {}),
    };

    const reviewDate = rule.provenance?.reviewedAt ?? rule.provenance?.observedAt ?? "1970-01-01";

    const record: RuleRecord = {
      id: rule.id,
      recordType: "rule",
      slug,
      title,
      summary,
      status: rule.event,
      event: rule.event,
      ...(rule.deadline !== undefined ? { date: rule.deadline } : {}),
      dates,
      affectedRange: rule.vers,
      ...(rule.replacement ? { replacement: rule.replacement } : {}),
      ...(rule.migration ? { migration: migrationToMarkdown(rule.migration) } : {}),
      ...(rule.severity ? { severity: rule.severity } : {}),
      ...(rule.confidence ? { confidence: rule.confidence } : {}),
      sources: rule.sources ?? [],
      reviewDate,
      links: {
        component: "",
        apiUrl: "",
        sourcePath: `registry/${rule.ecosystem}.json`,
      },
    };

    records.set(rule.id, record);
  }

  return records;
}
