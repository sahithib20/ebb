import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { confidenceOf, isOfficialSource } from "../src/confidence.js";

describe("confidenceOf", () => {
  it("uses explicit confidence when present", () => {
    assert.equal(confidenceOf({ confidence: "confirmed" }), "confirmed");
    assert.equal(confidenceOf({ confidence: "likely" }), "likely");
    assert.equal(confidenceOf({ confidence: "tentative" }), "tentative");
  });

  it("derives confirmed for manual review with an official source", () => {
    const rule = {
      sources: [{ url: "https://nodejs.org/en/about/previous-releases" }],
      provenance: { method: "manual", reviewedAt: "2026-10-01" },
    };
    assert.equal(confidenceOf(rule), "confirmed");
  });

  it("derives confirmed for upstream review with an official source", () => {
    const rule = {
      sources: [{ url: "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json" }],
      provenance: { method: "upstream", reviewedAt: "2026-10-01" },
    };
    assert.equal(confidenceOf(rule), "confirmed");
  });

  it("derives likely for importer-only rules", () => {
    const rule = {
      sources: [{ url: "https://nodejs.org/en/about/previous-releases" }],
      provenance: { method: "imported", reviewedAt: "2026-10-01", importer: "node-schedule" },
    };
    assert.equal(confidenceOf(rule), "likely");
  });

  it("derives likely when manual rule only cites aggregator sources", () => {
    const rule = {
      sources: [{ url: "https://endoflife.date/redis" }, { url: "https://en.wikipedia.org/wiki/Redis" }],
      provenance: { method: "manual", reviewedAt: "2026-10-01" },
    };
    assert.equal(confidenceOf(rule), "likely");
  });

  it("derives likely when reviewedAt date is missing", () => {
    const rule = {
      sources: [{ url: "https://nodejs.org/en/about/previous-releases" }],
      provenance: { method: "manual" },
    };
    assert.equal(confidenceOf(rule), "likely");
  });

  it("derives likely when sources are empty", () => {
    const rule = {
      sources: [],
      provenance: { method: "manual", reviewedAt: "2026-10-01" },
    };
    assert.equal(confidenceOf(rule), "likely");
  });

  it("never derives tentative automatically", () => {
    const cases = [
      {},
      { sources: [] },
      { provenance: { method: "manual" } },
      { provenance: { method: "imported" } },
      { sources: [{ url: "https://endoflife.date/foo" }] },
    ];
    for (const c of cases) {
      assert.notEqual(confidenceOf(c), "tentative");
    }
  });
});

describe("isOfficialSource", () => {
  it("recognizes official primary domains", () => {
    assert.equal(isOfficialSource("https://nodejs.org/en/about/previous-releases"), true);
    assert.equal(isOfficialSource("https://github.com/nodejs/node"), true);
    assert.equal(isOfficialSource("https://learn.microsoft.com/powershell"), true);
    assert.equal(isOfficialSource({ url: "https://python.org/downloads" }), true);
  });

  it("identifies known third-party aggregators as non-official", () => {
    assert.equal(isOfficialSource("https://endoflife.date/nodejs"), false);
    assert.equal(isOfficialSource("https://api.endoflife.date/v1/nodejs.json"), false);
    assert.equal(isOfficialSource("https://en.wikipedia.org/wiki/Node.js"), false);
    assert.equal(isOfficialSource("https://repology.org/project/nodejs/versions"), false);
  });

  it("handles malformed URLs safely without throwing", () => {
    assert.equal(isOfficialSource("not-a-url"), false);
    assert.equal(isOfficialSource(""), false);
  });
});
