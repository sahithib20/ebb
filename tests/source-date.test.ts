import assert from "node:assert/strict";
import { test } from "node:test";

import { containsDate } from "../tools/source-date.js";
import { checkSources } from "../tools/check-sources.js";
import type { RegistryV2Rule } from "../src/registry.js";

const NOW = new Date("2026-10-15T12:00:00Z");

test("containsDate matches ISO format", () => {
  assert.equal(containsDate("End of life is 2026-04-30.", "2026-04-30"), true);
  assert.equal(containsDate("Schedule: 2026/04/30.", "2026-04-30"), true);
});

test("containsDate matches long month format", () => {
  assert.equal(containsDate("Support ends on April 30, 2026 for this line.", "2026-04-30"), true);
  assert.equal(containsDate("On April 30th 2026 this release will expire.", "2026-04-30"), true);
  assert.equal(containsDate("The date 30 April 2026 is final.", "2026-04-30"), true);
  assert.equal(containsDate("On the 30th April, 2026.", "2026-04-30"), true);
});

test("containsDate matches short month format", () => {
  assert.equal(containsDate("EOL date: Apr 30, 2026.", "2026-04-30"), true);
  assert.equal(containsDate("Effective Apr. 30, 2026.", "2026-04-30"), true);
  assert.equal(containsDate("Scheduled 30 Apr 2026.", "2026-04-30"), true);
  assert.equal(containsDate("Planned for 30-Apr-2026.", "2026-04-30"), true);
});

test("containsDate matches day first numeric format", () => {
  assert.equal(containsDate("Maintenance ends 30/04/2026.", "2026-04-30"), true);
  assert.equal(containsDate("Released until 30-04-2026.", "2026-04-30"), true);
  assert.equal(containsDate("End date: 30.04.2026.", "2026-04-30"), true);
});

test("containsDate returns false when date does not appear on page", () => {
  assert.equal(containsDate("This page mentions nothing about April or 2026.", "2026-04-30"), false);
  assert.equal(containsDate("Released on 2025-01-01.", "2026-04-30"), false);
});

test("checkSources reports date-missing when date is absent and skips rules without a deadline", async () => {
  const urlWithDate = "https://example.com/has-date";
  const urlWithoutDate = "https://example.com/no-date";
  const urlNoDeadline = "https://example.com/no-deadline";

  const ruleWithDate: RegistryV2Rule = {
    id: "npm.pkg.with-date.deprecated",
    ecosystem: "npm",
    purl: "pkg:npm/with-date",
    vers: "vers:npm/*",
    event: "deprecated",
    title: "With Date",
    summary: "Summary",
    severity: "high",
    deadline: "2026-04-30",
    sources: [{ title: "Source", url: urlWithDate, accessedAt: "2026-10-01" }],
    provenance: { observedAt: "2026-10-01", reviewedAt: "2026-10-01", reviewer: "maintainer", method: "manual" },
  };

  const ruleMissingDate: RegistryV2Rule = {
    id: "npm.pkg.missing-date.deprecated",
    ecosystem: "npm",
    purl: "pkg:npm/missing-date",
    vers: "vers:npm/*",
    event: "deprecated",
    title: "Missing Date",
    summary: "Summary",
    severity: "high",
    deadline: "2026-04-30",
    sources: [{ title: "Source", url: urlWithoutDate, accessedAt: "2026-10-01" }],
    provenance: { observedAt: "2026-10-01", reviewedAt: "2026-10-01", reviewer: "maintainer", method: "manual" },
  };

  const ruleWithoutDeadline: RegistryV2Rule = {
    id: "npm.pkg.no-deadline.deprecated",
    ecosystem: "npm",
    purl: "pkg:npm/no-deadline",
    vers: "vers:npm/*",
    event: "deprecated",
    title: "No Deadline",
    summary: "Summary",
    severity: "high",
    sources: [{ title: "Source", url: urlNoDeadline, accessedAt: "2026-10-01" }],
    provenance: { observedAt: "2026-10-01", reviewedAt: "2026-10-01", reviewer: "maintainer", method: "manual" },
  };

  const { report } = await checkSources({
    registries: [
      {
        name: "npm",
        registry: {
          schemaVersion: "ebb.registry.v2",
          ecosystem: "npm",
          rules: [ruleWithDate, ruleMissingDate, ruleWithoutDeadline],
        },
      },
    ],
    lock: {
      schemaVersion: "ebb.source-lock.v1",
      sources: {
        [urlWithDate]: { finalUrl: urlWithDate, title: "Title", checkedAt: "2026-10-01" },
        [urlWithoutDate]: { finalUrl: urlWithoutDate, title: "Title", checkedAt: "2026-10-01" },
        [urlNoDeadline]: { finalUrl: urlNoDeadline, title: "Title", checkedAt: "2026-10-01" },
      },
    },
    now: NOW,
    observe: async (url) => {
      if (url === urlWithDate) {
        return {
          status: 200,
          finalUrl: url,
          title: "Title",
          contentSnippet: "This component will reach end of life on April 30, 2026.",
        };
      }
      return {
        status: 200,
        finalUrl: url,
        title: "Title",
        contentSnippet: "No deadline information is on this page at all.",
      };
    },
  });

  const missing = report["date-missing"] ?? [];
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.url, urlWithoutDate);
  assert.deepEqual(missing[0]?.ruleIds, ["npm.pkg.missing-date.deprecated"]);

  // The rule without deadline should not be in date-missing
  assert.ok(!missing.some((m) => m.url === urlNoDeadline));
});
