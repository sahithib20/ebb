import assert from "node:assert/strict";
import { test } from "node:test";

import { lookupProduct } from "../src/lookup.js";

test("lookup resolves a product purl with a mixed-case qualifier key", async () => {
  const canonical = await lookupProduct("pkg:npm/request", "2.88.2");
  const mixed = await lookupProduct("pkg:npm/request?Arch=x64", "2.88.2");

  assert.equal(mixed.product.purl, canonical.product.purl);
  assert.equal(mixed.product.id, canonical.product.id);
  assert.equal(mixed.status, canonical.status);
  assert.ok(mixed.findings.length > 0, "expected lifecycle findings for request@2.88.2");
});

test("lookup rejects a purl that is not a package URL", async () => {
  await assert.rejects(() => lookupProduct("pkg:"), /Invalid package URL/);
});

test("a fixture rule with two replacements loads with both, in order", async () => {
  const { validateRegistryV2 } = await import("../src/registry.js");
  const raw = {
    schemaVersion: "ebb.registry.v2",
    ecosystem: "npm",
    rules: [
      {
        id: "npm.package.fixture.deprecated",
        ecosystem: "npm",
        purl: "pkg:npm/fixture",
        vers: "vers:npm/*",
        event: "deprecated",
        title: "Fixture is deprecated",
        summary: "Use one of the two alternatives.",
        severity: "medium",
        replacement: "alt-one or alt-two",
        replacements: [
          {
            purl: "pkg:npm/alt-one",
            name: "alt-one",
            kind: "alternative",
            note: "First option",
          },
          {
            purl: "pkg:npm/alt-two",
            name: "alt-two",
            kind: "alternative",
            note: "Second option",
          },
        ],
        sources: [
          {
            title: "Deprecation Notice",
            url: "https://example.com/fixture-notice",
            accessedAt: "2026-11-01",
          },
        ],
        provenance: {
          observedAt: "2026-11-01",
          reviewedAt: "2026-11-02",
          reviewer: "arminazimi",
          method: "manual",
        },
      },
      {
        id: "npm.package.no-replacements.deprecated",
        ecosystem: "npm",
        purl: "pkg:npm/no-replacements",
        vers: "vers:npm/*",
        event: "deprecated",
        title: "No replacements rule",
        summary: "No replacements defined.",
        severity: "low",
        sources: [
          {
            title: "Notice",
            url: "https://example.com/no-rep-notice",
            accessedAt: "2026-11-01",
          },
        ],
        provenance: {
          observedAt: "2026-11-01",
          reviewedAt: "2026-11-02",
          reviewer: "arminazimi",
          method: "manual",
        },
      },
    ],
  };

  const loaded = validateRegistryV2(raw);
  assert.equal(loaded.rules.length, 2);

  const [withReplacements, withoutReplacements] = loaded.rules;
  assert.equal(withReplacements?.replacements?.length, 2);
  assert.equal(withReplacements?.replacements?.[0]?.purl, "pkg:npm/alt-one");
  assert.equal(withReplacements?.replacements?.[0]?.name, "alt-one");
  assert.equal(withReplacements?.replacements?.[0]?.kind, "alternative");
  assert.equal(withReplacements?.replacements?.[0]?.note, "First option");
  assert.equal(withReplacements?.replacements?.[1]?.purl, "pkg:npm/alt-two");
  assert.equal(withReplacements?.replacements?.[1]?.name, "alt-two");

  // Rule without replacements has undefined replacements property
  assert.equal(withoutReplacements?.replacements, undefined);
});
