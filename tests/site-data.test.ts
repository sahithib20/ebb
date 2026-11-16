import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RegistryV2Rule } from "../src/registry.js";
import { generateComponentRecord } from "../tools/site-data/components.js";
import { generateSiteData } from "../tools/site-data/generate.js";
import { generateLineRecordsForComponent } from "../tools/site-data/lines.js";
import { resolveLinks } from "../tools/site-data/links.js";
import { generateRuleRecords } from "../tools/site-data/rules.js";
import { deriveComponentSlug, SlugTracker } from "../tools/site-data/slug.js";
import { validateSiteDataDir } from "../tools/site-data/validate.js";

test("site-data-1: schema validates the documentation examples", async () => {
  const { compileSiteDataSchema } = await import("../tools/site-data/validate.js");
  const validate = await compileSiteDataSchema();
  const doc = await readFile("docs/site-data.md", "utf8");

  // Extract JSON blocks from docs/site-data.md
  const blocks = doc.match(/```json\n([\s\S]*?)\n```/g) || [];
  assert.ok(blocks.length >= 3, `Expected at least 3 JSON examples in docs, found ${blocks.length}`);

  let componentFound = false;
  let ruleFound = false;
  let lineFound = false;

  for (const block of blocks) {
    const raw = block.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(raw);
    const valid = validate(parsed);
    assert.equal(
      valid,
      true,
      `Example failed schema validation: ${JSON.stringify(validate.errors)} for block: ${raw.slice(0, 100)}`,
    );

    if (parsed.recordType === "component") componentFound = true;
    if (parsed.recordType === "rule") ruleFound = true;
    if (parsed.recordType === "release-line") lineFound = true;
  }

  assert.ok(componentFound, "Expected component example in docs");
  assert.ok(ruleFound, "Expected rule example in docs");
  assert.ok(lineFound, "Expected release-line example in docs");
});

test("site-data-2: generate component records deterministically with identical outputs", async () => {
  const dir1 = await mkdtemp(join(tmpdir(), "ebb-site-data-run1-"));
  const dir2 = await mkdtemp(join(tmpdir(), "ebb-site-data-run2-"));
  try {
    const res1 = await generateSiteData({ outDir: dir1 });
    const res2 = await generateSiteData({ outDir: dir2 });

    assert.equal(res1.componentCount, res2.componentCount);
    assert.equal(res1.ruleCount, res2.ruleCount);
    assert.equal(res1.lineCount, res2.lineCount);
    assert.equal(res1.files.length, res2.files.length);
    assert.equal(res1.totalBytes, res2.totalBytes);

    // Verify byte-for-byte identity of generated files
    for (const file of res1.files) {
      const buf1 = await readFile(join(dir1, file));
      const buf2 = await readFile(join(dir2, file));
      assert.deepEqual(buf1, buf2, `File ${file} differed across identical generation runs`);
    }

    // Verify component record structure
    const requestComp = JSON.parse(await readFile(join(dir1, "components/npm-request.json"), "utf8"));
    assert.equal(requestComp.id, "pkg:npm/request");
    assert.equal(requestComp.name, "request");
    assert.equal(requestComp.ecosystem, "npm");
    assert.equal(requestComp.status, "deprecated");
    assert.ok(Array.isArray(requestComp.rules));
    assert.ok(requestComp.rules.includes("npm.package.request.deprecated"));
  } finally {
    await rm(dir1, { recursive: true, force: true });
    await rm(dir2, { recursive: true, force: true });
  }
});

test("site-data-3: generate rule records with markdown migration and correct count", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ebb-site-data-rules-"));
  try {
    const res = await generateSiteData({ outDir: dir });
    const rulesColl = JSON.parse(await readFile(join(dir, "rules.json"), "utf8"));

    assert.equal(rulesColl.records.length, res.ruleCount);

    const requestRule = JSON.parse(await readFile(join(dir, "rules/npm-package-request-deprecated.json"), "utf8"));
    assert.equal(requestRule.id, "npm.package.request.deprecated");
    assert.equal(requestRule.event, "deprecated");
    assert.equal(requestRule.affectedRange, "vers:npm/*");
    assert.ok(requestRule.sources.length > 0);
    assert.ok(requestRule.reviewDate);

    // Check migration text included as Markdown unchanged
    if (requestRule.migration) {
      assert.match(requestRule.migration, /### Constraints|### Steps|### Verification/);
      assert.doesNotMatch(requestRule.migration, /<[^>]+>/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("site-data-4: generate release lines with statuses and handle incomplete cases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ebb-site-data-lines-"));
  try {
    await generateSiteData({ outDir: dir });

    // Verify Node.js release lines
    const node20 = JSON.parse(await readFile(join(dir, "lines/nodejs-nodejs-line-20-x.json"), "utf8"));
    assert.equal(node20.line, "20.x");
    assert.equal(node20.recordType, "release-line");
    assert.ok(["ended", "ending", "no-known-end"].includes(node20.status));

    // Test incomplete case using a custom component with gaps in release lines
    const mockRules: RegistryV2Rule[] = [
      {
        id: "mock.rule.1",
        ecosystem: "npm",
        purl: "pkg:npm/mock-package",
        vers: "vers:npm/>=1.0.0|<2.0.0",
        event: "end-of-life",
        title: "Mock line 1",
        summary: "Mock line 1 ended",
        severity: "medium",
        sources: [{ title: "Source", url: "https://example.com" }],
        provenance: { observedAt: "2026-01-01", reviewedAt: "2026-01-01", reviewer: "arminazimi", method: "manual" },
      },
      // Note: line 2 is missing, leaving a gap before line 3
      {
        id: "mock.rule.3",
        ecosystem: "npm",
        purl: "pkg:npm/mock-package",
        vers: "vers:npm/>=3.0.0|<4.0.0",
        event: "end-of-life",
        title: "Mock line 3",
        summary: "Mock line 3 ended",
        severity: "medium",
        sources: [{ title: "Source", url: "https://example.com" }],
        provenance: { observedAt: "2026-01-01", reviewedAt: "2026-01-01", reviewer: "arminazimi", method: "manual" },
      },
    ];

    const tracker = new SlugTracker();
    const lines = generateLineRecordsForComponent({
      purl: "pkg:npm/mock-package",
      name: "mock-package",
      componentSlug: "npm-mock-package",
      ecosystem: "npm",
      rules: mockRules,
      asOf: "2026-01-01",
      slugTracker: tracker,
    });

    assert.ok(lines.length > 0);
    // Since lines 1 and 3 have a gap (missing 2), supportedVersions reports complete: false
    assert.equal(lines[0]!.incomplete, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("site-data-5: slugs, collision resolution, lock file, and redirects", () => {
  // 1. Scoped npm package
  const scopedSlug = deriveComponentSlug("npm", "@angular/core");
  assert.equal(scopedSlug, "npm-angular-core");

  // 2. Collision handling
  const tracker = new SlugTracker();
  const slugA = tracker.allocate("id-1", "pkg-foo");
  const slugB = tracker.allocate("id-2", "pkg-foo");
  assert.equal(slugA, "pkg-foo");
  assert.equal(slugB, "pkg-foo-2");

  // 3. Slug rename without entry throws error
  const lockedTracker = new SlugTracker({
    slugs: {
      "pkg:npm/old-pkg": "npm-old-pkg",
    },
  });

  assert.throws(
    () => lockedTracker.allocate("pkg:npm/old-pkg", "npm-new-pkg"),
    (err: Error) => {
      assert.match(err.message, /changed from "npm-old-pkg" to "npm-new-pkg" without a redirect entry/);
      return true;
    },
  );

  // 4. Slug rename with entry succeeds and populates redirects
  const redirectTracker = new SlugTracker({
    slugs: {
      "pkg:npm/old-pkg": "npm-old-pkg",
    },
    redirects: {
      "npm-old-pkg": "npm-new-pkg",
    },
  });

  const allocated = redirectTracker.allocate("pkg:npm/old-pkg", "npm-new-pkg");
  assert.equal(allocated, "npm-new-pkg");
  const redirects = redirectTracker.getRedirects();
  assert.equal(redirects["npm-old-pkg"], "npm-new-pkg");
});

test("site-data-6: collection lists validate and every referenced ID exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ebb-site-data-collections-"));
  try {
    await generateSiteData({ outDir: dir });

    const ecosystems = JSON.parse(await readFile(join(dir, "ecosystems.json"), "utf8"));
    const upcoming = JSON.parse(await readFile(join(dir, "upcoming.json"), "utf8"));
    const releases = JSON.parse(await readFile(join(dir, "releases.json"), "utf8"));

    const components = JSON.parse(await readFile(join(dir, "components.json"), "utf8"));
    const rules = JSON.parse(await readFile(join(dir, "rules.json"), "utf8"));

    const compIds = new Set(components.records.map((c: { id: string }) => c.id));
    const ruleIds = new Set(rules.records.map((r: { id: string }) => r.id));

    // Every ID in ecosystems exists
    for (const eco of ecosystems.ecosystems) {
      assert.ok(eco.componentCount > 0);
      for (const id of eco.recordIds) {
        assert.ok(compIds.has(id), `Ecosystem references missing component id ${id}`);
      }
    }

    // Every ID in upcoming exists, and dates are >= dataVersion
    for (const month of upcoming.months) {
      for (const ev of month.events) {
        assert.ok(ruleIds.has(ev.ruleId), `Upcoming event references missing rule id ${ev.ruleId}`);
        assert.ok(compIds.has(ev.componentId), `Upcoming event references missing component id ${ev.componentId}`);
        assert.ok(ev.date >= "2026-11-15", `Upcoming event ${ev.date} is earlier than data date`);
      }
    }

    // Every ID in releases exists
    for (const rel of releases.releases) {
      for (const id of [...rel.added, ...rel.changed, ...rel.removed]) {
        assert.ok(ruleIds.has(id), `Releases references missing rule id ${id}`);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("site-data-7: titles and summaries satisfy length bounds and contain no HTML/Markdown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ebb-site-data-text-"));
  try {
    await generateSiteData({ outDir: dir });

    const components = JSON.parse(await readFile(join(dir, "components.json"), "utf8"));
    const rules = JSON.parse(await readFile(join(dir, "rules.json"), "utf8"));
    const lines = JSON.parse(await readFile(join(dir, "lines.json"), "utf8"));

    const allRecords = [...components.records, ...rules.records, ...lines.records];

    for (const rec of allRecords) {
      assert.ok(rec.title.length > 0 && rec.title.length <= 70, `Title exceeds limit for ${rec.id}: "${rec.title}"`);
      assert.ok(
        rec.summary.length > 0 && rec.summary.length <= 160,
        `Summary exceeds limit for ${rec.id}: "${rec.summary}"`,
      );
      assert.doesNotMatch(rec.title, /<[^>]+>/, `Title contains HTML: ${rec.title}`);
      assert.doesNotMatch(rec.title, /[*_~`#[\]]/, `Title contains Markdown: ${rec.title}`);
      assert.doesNotMatch(rec.summary, /<[^>]+>/, `Summary contains HTML: ${rec.summary}`);
      assert.doesNotMatch(rec.summary, /[*_~`#[\]]/, `Summary contains Markdown: ${rec.summary}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("site-data-8: all relational links resolve to existing records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ebb-site-data-links-"));
  try {
    await generateSiteData({ outDir: dir });

    const components = JSON.parse(await readFile(join(dir, "components.json"), "utf8"));
    const rules = JSON.parse(await readFile(join(dir, "rules.json"), "utf8"));
    const lines = JSON.parse(await readFile(join(dir, "lines.json"), "utf8"));

    const compSlugs = new Set(components.records.map((c: { slug: string }) => c.slug));
    const ruleSlugs = new Set(rules.records.map((r: { slug: string }) => r.slug));
    const lineSlugs = new Set(lines.records.map((l: { slug: string }) => l.slug));

    // Verify component links
    for (const comp of components.records) {
      assert.ok(comp.links.apiUrl.startsWith("http"));
      assert.ok(comp.links.sourcePath.startsWith("registry/"));
      for (const rSlug of comp.links.rules) {
        assert.ok(ruleSlugs.has(rSlug), `Component ${comp.slug} links to missing rule ${rSlug}`);
      }
      for (const lSlug of comp.links.lines) {
        assert.ok(lineSlugs.has(lSlug), `Component ${comp.slug} links to missing line ${lSlug}`);
      }
    }

    // Verify rule links
    for (const rule of rules.records) {
      assert.ok(rule.links.apiUrl.startsWith("http"));
      assert.ok(rule.links.sourcePath.startsWith("registry/"));
      assert.ok(
        compSlugs.has(rule.links.component),
        `Rule ${rule.slug} links to missing component ${rule.links.component}`,
      );
      if (rule.links.replacementComponent) {
        assert.ok(
          compSlugs.has(rule.links.replacementComponent),
          `Rule ${rule.slug} links to missing replacement ${rule.links.replacementComponent}`,
        );
      }
    }

    // Verify line links
    for (const line of lines.records) {
      assert.ok(line.links.apiUrl.startsWith("http"));
      assert.ok(line.links.sourcePath.startsWith("registry/"));
      assert.ok(
        compSlugs.has(line.links.component),
        `Line ${line.slug} links to missing component ${line.links.component}`,
      );
      assert.ok(ruleSlugs.has(line.links.rule), `Line ${line.slug} links to missing rule ${line.links.rule}`);
    }

    // Verify that replacement without record stays text only
    const mockRule: RegistryV2Rule = {
      id: "mock.rule.unknown.rep",
      ecosystem: "npm",
      purl: "pkg:npm/mock-pkg",
      vers: "*",
      event: "deprecated",
      title: "Mock with unknown replacement",
      summary: "Summary",
      severity: "low",
      replacement: "https://unknown-service.example.org/migration",
      sources: [{ title: "Source", url: "https://example.com" }],
      provenance: { observedAt: "2026-01-01", reviewedAt: "2026-01-01", reviewer: "arminazimi", method: "manual" },
    };

    const tracker = new SlugTracker();
    const ruleRecs = generateRuleRecords([mockRule], tracker);
    const compRec = generateComponentRecord({
      purl: "pkg:npm/mock-pkg",
      ecosystem: "npm",
      rules: [mockRule],
      asOf: "2026-01-01",
      slugTracker: tracker,
    });

    const compMap = new Map([[compRec.id, compRec]]);
    resolveLinks(compMap, ruleRecs, [], new Map([[mockRule.id, "npm"]]));

    const generatedRule = ruleRecs.get(mockRule.id)!;
    assert.equal(generatedRule.replacement, "https://unknown-service.example.org/migration");
    assert.equal(generatedRule.links.replacementComponent, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("site-data-10: validateSiteDataDir validates generated output cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ebb-site-data-val-"));
  try {
    await generateSiteData({ outDir: dir });
    const valResult = await validateSiteDataDir(dir);
    assert.equal(valResult.valid, true);
    assert.ok(valResult.checkedFiles > 1000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
