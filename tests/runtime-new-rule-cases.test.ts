import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { matchingRules } from "../tools/rule-cases.js";
import { validateRegistryV2, type RegistryV2Rule } from "../src/registry.js";
import { parseVers, versionScheme } from "../src/vers.js";

/**
 * New runtime rules introduced by runtimes-complete must have inside, outside,
 * and boundary cases (epic #534).
 */
const NEW_RULE_IDS = [
  "nodejs.runtime.eol-24",
  "nodejs.runtime.eol-26",
  "python.runtime.eol-3.11",
  "python.runtime.eol-3.12",
  "python.runtime.eol-3.13",
  "python.runtime.eol-3.14",
  "python.runtime.eol-3.15",
  "java.jdk.scheduled-end-of-support-27",
  "dotnet.runtime.end-of-support-10.0",
  "dotnet.runtime.end-of-support-11.0",
  "ruby.runtime.eol-3.3",
  "php.runtime.end-of-active-support-8.2",
  "php.runtime.eol-8.2",
  "php.runtime.end-of-active-support-8.3",
  "php.runtime.eol-8.3",
  "php.runtime.end-of-active-support-8.4",
  "php.runtime.eol-8.4",
  "php.runtime.end-of-active-support-8.5",
  "php.runtime.eol-8.5",
  "deno.runtime.lts-2-1.end-of-support",
  "deno.runtime.lts-2-2.end-of-support",
  "deno.runtime.lts-2-5.end-of-support",
  "deno.runtime.lts-2-9.scheduled-end-of-support",
] as const;

type CaseRow = { purl: string; version: string; rules: string[] };

function loadCases(): CaseRow[] {
  const root = join(process.cwd(), "cases");
  const files = [
    "nodejs.json",
    "python.json",
    "java.json",
    "dotnet.json",
    "ruby.json",
    "php.json",
    "deno.json",
    "go.json",
    "rust.json",
  ];
  const out: CaseRow[] = [];
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(root, file), "utf8")) as { cases: CaseRow[] };
    out.push(...raw.cases);
  }
  return out;
}

function loadRules(): RegistryV2Rule[] {
  const files = ["nodejs", "python", "java", "dotnet", "ruby", "php", "deno"];
  const rules: RegistryV2Rule[] = [];
  for (const name of files) {
    const registry = validateRegistryV2(JSON.parse(readFileSync(join("registry", `${name}.json`), "utf8")));
    rules.push(...registry.rules);
  }
  return rules;
}

test("every new runtime rule has inside, outside, and boundary cases", () => {
  const cases = loadCases();
  const rules = loadRules();
  for (const id of NEW_RULE_IDS) {
    const rule = rules.find((r) => r.id === id);
    assert.ok(rule, `missing rule ${id}`);
    const range = parseVers(rule.vers);
    const lower = range.constraints.find((constraint) => constraint.comparator === ">=");
    assert.ok(lower, `cannot find inclusive lower bound for ${id}: ${rule.vers}`);
    const scheme = versionScheme(range.scheme);
    const mentioning = cases.filter((c) => c.purl === rule.purl && c.rules.includes(id));
    const boundary = mentioning.find((c) => scheme.compare(c.version, lower.version) === 0);
    assert.ok(boundary, `${id} needs a boundary case at ${lower.version}`);

    const inside = mentioning.find(
      (c) => scheme.compare(c.version, lower.version) > 0 && matchingRules([rule], c.purl, c.version).includes(id),
    );
    assert.ok(inside, `${id} needs a matching inside case beyond the lower bound`);

    const outside = cases.find((c) => c.purl === rule.purl && !c.rules.includes(id));
    assert.ok(outside, `${id} needs an outside case for ${rule.purl}`);

    // Outside must not match the rule via VERS.
    const matched = matchingRules([rule], outside.purl, outside.version);
    assert.deepEqual(matched, [], `${id} outside case ${outside.version} still matches`);
  }
});
