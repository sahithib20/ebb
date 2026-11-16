// Generates Markdown release notes and JSON diff asset from data diffs.
//
//   node dist/tools/data-release-notes.js --from previous.json --to active.json --out out/release-notes.md --json-diff out/data-diff.json

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { diff, type DataDiffResult, type DiffTarget } from "../src/diff.js";

function ruleLink(ruleId: string, baseUrl = "https://velella.sh/ebb/api/v1"): string {
  return `[\`${ruleId}\`](${baseUrl}/rules/${encodeURIComponent(ruleId)}.json)`;
}

/**
 * Formats Markdown release notes from a DataDiffResult:
 * - First line contains change counts.
 * - Grouped by ecosystem.
 * - Each rule links to its rule file in the static API.
 * - Unchanged rules are never included.
 */
export function formatReleaseNotes(diffResult: DataDiffResult, options: { baseUrl?: string | undefined } = {}): string {
  const { summary, added, changed, removed, renamed } = diffResult;
  const baseUrl = options.baseUrl ?? "https://velella.sh/ebb/api/v1";
  const firstLine = `${summary.added} added, ${summary.changed} changed, ${summary.removed} removed.`;

  if (summary.added === 0 && summary.changed === 0 && summary.removed === 0 && summary.renamed === 0) {
    return firstLine;
  }

  const lines: string[] = [firstLine, ""];

  const ecosystems = Object.keys(summary.byEcosystem).sort();
  for (const eco of ecosystems) {
    const ecoDiff = summary.byEcosystem[eco];
    if (!ecoDiff || (ecoDiff.added === 0 && ecoDiff.changed === 0 && ecoDiff.removed === 0 && ecoDiff.renamed === 0)) {
      continue;
    }

    lines.push(`### ${eco}`);

    const ecoAdded = added.filter((r) => r.ecosystem === eco);
    for (const rule of ecoAdded) {
      const deadlineStr = rule.deadline ? `, deadline: ${rule.deadline}` : "";
      lines.push(
        `- **Added** ${ruleLink(rule.id, baseUrl)} (\`${rule.purl}\`): ${rule.title} (${rule.event}, vers: \`${rule.vers}\`${deadlineStr})`,
      );
    }

    const ecoChanged = changed.filter((c) => c.ecosystem === eco);
    for (const ch of ecoChanged) {
      const changeSummaries = ch.changes.map((c) => c.description ?? `${c.field} updated`).join("; ");
      lines.push(`- **Changed** ${ruleLink(ch.id, baseUrl)} (\`${ch.purl}\`): ${ch.title} — ${changeSummaries}`);
    }

    const ecoRenamed = renamed.filter((r) => r.ecosystem === eco);
    for (const ren of ecoRenamed) {
      lines.push(`- **Renamed** ${ruleLink(ren.fromId, baseUrl)} → ${ruleLink(ren.toId, baseUrl)} (\`${ren.purl}\`)`);
    }

    const ecoRemoved = removed.filter((r) => r.ecosystem === eco);
    for (const rule of ecoRemoved) {
      lines.push(`- **Removed** ${ruleLink(rule.id, baseUrl)} (\`${rule.purl}\`): ${rule.title}`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export async function generateReleaseNotes(
  from: DiffTarget,
  to: DiffTarget,
  options: { baseUrl?: string | undefined } = {},
): Promise<{ notes: string; diffResult: DataDiffResult }> {
  const diffResult = await diff(from, to);
  const notes = formatReleaseNotes(diffResult, options);
  return { notes, diffResult };
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function main(argv: string[]): Promise<void> {
  const fromTarget = option(argv, "--from") ?? "bundled";
  const toTarget = option(argv, "--to") ?? "active";
  const outPath = option(argv, "--out");
  const jsonDiffPath = option(argv, "--json-diff");

  const { notes, diffResult } = await generateReleaseNotes(fromTarget, toTarget);

  if (outPath) {
    const resolvedOut = resolve(outPath);
    await mkdir(dirname(resolvedOut), { recursive: true });
    await writeFile(resolvedOut, `${notes}\n`, "utf8");
    process.stdout.write(`Wrote release notes to ${resolvedOut}\n`);
  } else {
    process.stdout.write(`${notes}\n`);
  }

  if (jsonDiffPath) {
    const resolvedDiff = resolve(jsonDiffPath);
    await mkdir(dirname(resolvedDiff), { recursive: true });
    await writeFile(resolvedDiff, `${JSON.stringify(diffResult, null, 2)}\n`, "utf8");
    process.stdout.write(`Wrote JSON diff to ${resolvedDiff}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
