import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

export async function compileSiteDataSchema(schemaPath?: string): Promise<ValidateFunction> {
  const path = schemaPath ?? resolve("schemas/site-data.v1.schema.json");
  const schemaRaw = await readFile(path, "utf8");
  const schema = JSON.parse(schemaRaw);

  const ajv = new Ajv2020({ allErrors: true });
  return ajv.compile(schema);
}

export async function validateSiteDataDir(
  dir: string,
  options?: { schemaPath?: string; root?: string },
): Promise<{ valid: boolean; checkedFiles: number }> {
  const targetDir = resolve(dir);
  const validate = await compileSiteDataSchema(options?.schemaPath);

  let checkedFiles = 0;
  const errors: string[] = [];

  // Track all discovered record slugs and IDs
  const knownComponentSlugs = new Set<string>();
  const knownRuleSlugs = new Set<string>();
  const knownLineSlugs = new Set<string>();
  const knownComponentIds = new Set<string>();
  const knownRuleIds = new Set<string>();
  const knownLineIds = new Set<string>();

  // Helper to validate and check text fields
  function checkRecordText(record: Record<string, unknown>, file: string): void {
    const title = record.title;
    if (typeof title === "string") {
      if (title.length > 70) {
        errors.push(`${file}: title exceeds 70 characters (${title.length}): "${title}"`);
      }
      if (/<[^>]*>/.test(title)) {
        errors.push(`${file}: title contains HTML: "${title}"`);
      }
      if (/[*_~`#[\]]/.test(title)) {
        errors.push(`${file}: title contains Markdown characters: "${title}"`);
      }
    }

    const summary = record.summary;
    if (typeof summary === "string") {
      if (summary.length > 160) {
        errors.push(`${file}: summary exceeds 160 characters (${summary.length}): "${summary}"`);
      }
      if (/<[^>]*>/.test(summary)) {
        errors.push(`${file}: summary contains HTML: "${summary}"`);
      }
      if (/[*_~`#[\]]/.test(summary)) {
        errors.push(`${file}: summary contains Markdown characters: "${summary}"`);
      }
    }
  }

  // 1. Read collection files if present to populate known IDs and slugs
  for (const collName of ["components.json", "rules.json", "lines.json"]) {
    try {
      const content = await readFile(join(targetDir, collName), "utf8");
      const doc = JSON.parse(content);
      checkedFiles++;
      const ok = validate(doc);
      if (!ok) {
        errors.push(`${collName} failed schema validation: ${JSON.stringify(validate.errors)}`);
      }

      if (Array.isArray(doc.records)) {
        for (const rec of doc.records) {
          if (rec.recordType === "component") {
            knownComponentSlugs.add(rec.slug);
            knownComponentIds.add(rec.id);
          } else if (rec.recordType === "rule") {
            knownRuleSlugs.add(rec.slug);
            knownRuleIds.add(rec.id);
          } else if (rec.recordType === "release-line") {
            knownLineSlugs.add(rec.slug);
            knownLineIds.add(rec.id);
          }
          checkRecordText(rec, collName);
        }
      }
    } catch (err: unknown) {
      // file might not exist in a partial test run
    }
  }

  // 2. Scan components/ folder
  try {
    const compFiles = await readdir(join(targetDir, "components"));
    for (const f of compFiles) {
      if (!f.endsWith(".json")) continue;
      const content = await readFile(join(targetDir, "components", f), "utf8");
      const doc = JSON.parse(content);
      checkedFiles++;
      const ok = validate(doc);
      if (!ok) {
        errors.push(`components/${f} failed schema: ${JSON.stringify(validate.errors)}`);
      }
      knownComponentSlugs.add(doc.slug);
      knownComponentIds.add(doc.id);
      checkRecordText(doc, `components/${f}`);
    }
  } catch {
    // folder might not exist
  }

  // 3. Scan rules/ folder
  try {
    const ruleFiles = await readdir(join(targetDir, "rules"));
    for (const f of ruleFiles) {
      if (!f.endsWith(".json")) continue;
      const content = await readFile(join(targetDir, "rules", f), "utf8");
      const doc = JSON.parse(content);
      checkedFiles++;
      const ok = validate(doc);
      if (!ok) {
        errors.push(`rules/${f} failed schema: ${JSON.stringify(validate.errors)}`);
      }
      knownRuleSlugs.add(doc.slug);
      knownRuleIds.add(doc.id);
      checkRecordText(doc, `rules/${f}`);
    }
  } catch {
    // folder might not exist
  }

  // 4. Scan lines/ folder
  try {
    const lineFiles = await readdir(join(targetDir, "lines"));
    for (const f of lineFiles) {
      if (!f.endsWith(".json")) continue;
      const content = await readFile(join(targetDir, "lines", f), "utf8");
      const doc = JSON.parse(content);
      checkedFiles++;
      const ok = validate(doc);
      if (!ok) {
        errors.push(`lines/${f} failed schema: ${JSON.stringify(validate.errors)}`);
      }
      knownLineSlugs.add(doc.slug);
      knownLineIds.add(doc.id);
      checkRecordText(doc, `lines/${f}`);
    }
  } catch {
    // folder might not exist
  }

  // 5. Check metadata / collection files: ecosystems.json, upcoming.json, releases.json, redirects.json, index.json
  const checkExtra = async (fileName: string) => {
    try {
      const content = await readFile(join(targetDir, fileName), "utf8");
      const doc = JSON.parse(content);
      checkedFiles++;
      const ok = validate(doc);
      if (!ok) {
        errors.push(`${fileName} failed schema: ${JSON.stringify(validate.errors)}`);
      }

      // Check ID references in collection files
      if (fileName === "ecosystems.json" && Array.isArray(doc.ecosystems)) {
        for (const eco of doc.ecosystems) {
          for (const id of eco.recordIds ?? []) {
            if (!knownComponentIds.has(id)) {
              errors.push(`ecosystems.json references non-existent component id "${id}"`);
            }
          }
        }
      }
      if (fileName === "upcoming.json" && Array.isArray(doc.months)) {
        for (const m of doc.months) {
          for (const ev of m.events ?? []) {
            if (!knownRuleIds.has(ev.ruleId)) {
              errors.push(`upcoming.json references non-existent rule id "${ev.ruleId}"`);
            }
            if (!knownComponentIds.has(ev.componentId)) {
              errors.push(`upcoming.json references non-existent component id "${ev.componentId}"`);
            }
          }
        }
      }
      if (fileName === "releases.json" && Array.isArray(doc.releases)) {
        for (const rel of doc.releases) {
          for (const id of [...(rel.added ?? []), ...(rel.changed ?? []), ...(rel.removed ?? [])]) {
            if (!knownRuleIds.has(id)) {
              errors.push(`releases.json references non-existent rule id "${id}"`);
            }
          }
        }
      }
    } catch {
      // file might not exist in partial test
    }
  };

  await checkExtra("ecosystems.json");
  await checkExtra("upcoming.json");
  await checkExtra("releases.json");
  await checkExtra("redirects.json");
  await checkExtra("index.json");

  // 6. Check link references across records
  const checkLinks = async (folder: string, type: "component" | "rule" | "line") => {
    try {
      const files = await readdir(join(targetDir, folder));
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const content = await readFile(join(targetDir, folder, f), "utf8");
        const doc = JSON.parse(content);
        const links = doc.links;
        if (!links) continue;

        if (type === "component") {
          for (const rSlug of links.rules ?? []) {
            if (!knownRuleSlugs.has(rSlug)) {
              errors.push(`${folder}/${f}: linked rule slug "${rSlug}" does not exist`);
            }
          }
          for (const lSlug of links.lines ?? []) {
            if (!knownLineSlugs.has(lSlug)) {
              errors.push(`${folder}/${f}: linked line slug "${lSlug}" does not exist`);
            }
          }
        } else if (type === "rule") {
          if (links.component && !knownComponentSlugs.has(links.component)) {
            errors.push(`${folder}/${f}: linked component slug "${links.component}" does not exist`);
          }
          if (links.replacementComponent && !knownComponentSlugs.has(links.replacementComponent)) {
            errors.push(
              `${folder}/${f}: linked replacementComponent slug "${links.replacementComponent}" does not exist`,
            );
          }
        } else if (type === "line") {
          if (links.component && !knownComponentSlugs.has(links.component)) {
            errors.push(`${folder}/${f}: linked component slug "${links.component}" does not exist`);
          }
          if (links.rule && !knownRuleSlugs.has(links.rule)) {
            errors.push(`${folder}/${f}: linked rule slug "${links.rule}" does not exist`);
          }
        }
      }
    } catch {
      // ignore
    }
  };

  await checkLinks("components", "component");
  await checkLinks("rules", "rule");
  await checkLinks("lines", "line");

  if (errors.length > 0) {
    throw new Error(
      `Site data validation failed with ${errors.length} error(s):\n  ` + errors.slice(0, 20).join("\n  "),
    );
  }

  return { valid: true, checkedFiles };
}
