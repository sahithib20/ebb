import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { escapeICalText, foldICalLine, toICal } from "../src/export/ical.js";
import type { RegistryV2Rule } from "../src/registry.js";

function rule(partial: Partial<RegistryV2Rule> & { id: string; deadline: string }): RegistryV2Rule {
  return {
    id: partial.id,
    ecosystem: partial.ecosystem ?? "npm",
    purl: partial.purl ?? "pkg:npm/example",
    vers: partial.vers ?? "vers:npm/*",
    event: partial.event ?? "end-of-life",
    title: partial.title ?? `Title for ${partial.id}`,
    summary: partial.summary ?? `Summary for ${partial.id}`,
    severity: partial.severity ?? "high",
    deadline: partial.deadline,
    sources: partial.sources ?? [{ title: "Source", url: "https://example.com/eol" }],
    provenance: partial.provenance ?? {
      observedAt: "2026-01-02",
      reviewedAt: "2026-01-15",
      reviewer: "test",
      method: "manual",
    },
    ...(partial.replacement ? { replacement: partial.replacement } : {}),
  };
}

function physicalLines(ics: string): string[] {
  assert.equal(ics.endsWith("\r\n"), true);
  const lines = ics.split("\r\n");
  assert.equal(lines.at(-1), "");
  lines.pop();
  return lines;
}

function unfold(ics: string): string[] {
  const logical: string[] = [];
  for (const line of physicalLines(ics)) {
    if (line.startsWith(" ")) {
      logical[logical.length - 1] = `${logical.at(-1) ?? ""}${line.slice(1)}`;
    } else {
      logical.push(line);
    }
  }
  return logical;
}

function field(ics: string, name: string): string {
  const prefix = `${name}:`;
  const found = unfold(ics).find((line) => line.startsWith(prefix) || line.startsWith(`${name};`));
  assert.ok(found, `missing ${name}`);
  return found.slice(found.indexOf(":") + 1);
}

describe("toICal", () => {
  it("escapes commas, semicolons, backslashes and newlines", () => {
    assert.equal(escapeICalText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  });

  it("folds on octet boundaries and keeps a multi-byte character whole", () => {
    const head = "SUMMARY:";
    const text = `${"a".repeat(74 - head.length)}ézzz`;
    const folded = foldICalLine(`${head}${escapeICalText(text)}`);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (const line of folded.split("\r\n")) {
      const bytes = encoder.encode(line);
      assert.ok(bytes.length <= 75, `line is ${bytes.length} octets`);
      decoder.decode(bytes);
    }
    assert.match(folded, /\r\n /);
    assert.match(folded, /é/);
    const joined = folded.split("\r\n ").join("");
    assert.equal(joined, `${head}${text}`);
  });

  it("keeps the UID when the date changes and raises SEQUENCE", () => {
    const shared = { id: "npm.example.eol", purl: "pkg:npm/example" };
    const early = toICal({
      rules: [rule({ ...shared, deadline: "2026-06-01" })],
      asOf: "2026-01-01",
      within: "10y",
    });
    const later = toICal({
      rules: [rule({ ...shared, deadline: "2027-06-01" })],
      asOf: "2026-01-01",
      within: "10y",
    });
    assert.equal(field(early, "UID"), "npm.example.eol@velella.sh");
    assert.equal(field(later, "UID"), field(early, "UID"));
    assert.ok(Number(field(later, "SEQUENCE")) > Number(field(early, "SEQUENCE")));
  });

  it("writes all-day events, stamps them from the data, and sorts by date then id", () => {
    const rules = [
      rule({ id: "b.rule", deadline: "2026-03-01" }),
      rule({ id: "a.rule", deadline: "2026-03-01" }),
      rule({ id: "c.rule", deadline: "2026-02-01" }),
    ];
    const once = toICal({ rules, asOf: "2026-01-01", within: "1y" });
    const twice = toICal({ rules, asOf: "2026-01-01", within: "1y" });
    assert.equal(once, twice);
    assert.match(once, /DTSTAMP:20260115T000000Z/);
    assert.doesNotMatch(once, /DTSTAMP:20261115/);
    const uids = unfold(once)
      .filter((line) => line.startsWith("UID:"))
      .map((line) => line.slice(4));
    assert.deepEqual(uids, ["c.rule@velella.sh", "a.rule@velella.sh", "b.rule@velella.sh"]);
    assert.match(once, /DTSTART;VALUE=DATE:20260201\r\nDTEND;VALUE=DATE:20260202/);
  });

  it("fills summary, description, component URL and category for one rule", () => {
    const ics = toICal({
      rules: [
        rule({
          id: "npm.example.eol",
          purl: "pkg:npm/example",
          deadline: "2026-06-01",
          title: "Example, ended; see notes",
          summary: "First line\nSecond line",
          replacement: "pkg:npm/other",
          event: "end-of-life",
          sources: [
            { title: "Vendor", url: "https://example.com/eol" },
            { title: "Other", url: "https://example.com/other" },
          ],
        }),
      ],
      asOf: "2026-01-01",
      within: "1y",
    });
    assert.equal(field(ics, "SUMMARY"), "Example\\, ended\\; see notes");
    const description = field(ics, "DESCRIPTION");
    assert.ok(description.includes("First line\\nSecond line"));
    assert.match(description, /Replacement: pkg:npm\/other/);
    assert.match(description, /https:\/\/example\.com\/eol/);
    assert.doesNotMatch(description, /example\.com\/other/);
    assert.equal(field(ics, "URL"), "https://velella.sh/ebb/api/v1/npm/example.json");
    assert.equal(field(ics, "CATEGORIES"), "end-of-life");
  });

  it("filters by ecosystem, purl and window, including all three at once", () => {
    const rules = [
      rule({
        id: "npm.a",
        purl: "pkg:npm/a",
        vers: "vers:npm/>=1.0.0|<2.0.0",
        deadline: "2026-06-01",
        ecosystem: "npm",
      }),
      rule({ id: "npm.b", purl: "pkg:npm/b", deadline: "2026-08-01", ecosystem: "npm" }),
      rule({
        id: "pypi.a",
        purl: "pkg:pypi/a",
        vers: "vers:pypi/*",
        deadline: "2026-06-01",
        ecosystem: "pypi",
      }),
    ];
    const uids = (ics: string) =>
      unfold(ics)
        .filter((line) => line.startsWith("UID:"))
        .map((line) => line.slice(4, line.indexOf("@")));

    assert.deepEqual(uids(toICal({ rules, asOf: "2026-06-01", within: "1y", ecosystem: "npm" })), ["npm.a", "npm.b"]);
    assert.deepEqual(uids(toICal({ rules, asOf: "2026-06-01", within: "1y", purl: "pkg:npm/a@1.5.0" })), ["npm.a"]);
    assert.deepEqual(uids(toICal({ rules, asOf: "2026-06-01", within: "1d" })), ["npm.a", "pypi.a"]);

    const combined = toICal({
      rules,
      asOf: "2026-06-01",
      within: "30d",
      ecosystem: "npm",
      purl: "pkg:npm/a@1.5.0",
    });
    assert.deepEqual(uids(combined), ["npm.a"]);
    assert.match(combined, /NAME:Ebb npm pkg:npm\/a@1\.5\.0 \(30d\)/);
  });
});
