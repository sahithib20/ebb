import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CheckError } from "../../src/check-core.js";
import { getActiveDataSync } from "../../src/data-source.js";
import { setNodeLoaderProvider } from "../../src/data/load.js";
import { supportedVersions } from "../../src/pick-version.js";
import type { RegistryV2Rule } from "../../src/registry.js";

setNodeLoaderProvider(getActiveDataSync);

function rule(id: string, vers: string, deadline: string): RegistryV2Rule {
  return {
    id,
    ecosystem: "npm",
    purl: "pkg:npm/example",
    vers,
    event: "scheduled-end-of-life",
    title: id,
    summary: id,
    severity: "low",
    deadline,
    sources: [{ title: "Example", url: "https://example.com/rule" }],
    provenance: {
      observedAt: "2026-01-01",
      reviewedAt: "2026-01-01",
      reviewer: "test",
      method: "manual",
    },
  };
}

describe("completeness of release lines", () => {
  it("marks a contiguous runtime complete and still notes versions past the last rule", () => {
    const node = supportedVersions("node", { asOf: "2026-11-15" });
    assert.equal(node.complete, true);
    assert.ok(node.notes.some((note) => note.includes("newer than 26.x")));
    assert.ok(node.notes.some((note) => note.includes("nodejs.runtime.legacy")));

    const python = supportedVersions("python", { asOf: "2026-11-15" });
    assert.equal(python.complete, true);
    assert.ok(python.notes.some((note) => note.includes("newer than 3.15")));
  });

  it("marks a gap as incomplete and does not call the missing line supported", () => {
    const result = supportedVersions("pkg:npm/example", {
      asOf: "2026-11-15",
      rules: [
        rule("example.1", "vers:semver/>=1.0.0|<2.0.0", "2024-01-01"),
        rule("example.3", "vers:semver/>=3.0.0|<4.0.0", "2030-01-01"),
      ],
    });
    assert.equal(result.complete, false);
    assert.deepEqual(
      result.lines.map((line) => line.id),
      ["1.x", "3.x"],
    );
    assert.ok(result.notes.some((note) => note === "No rule covers 2.x."));
    assert.equal(result.recommendation?.lineId, "3.x");
    assert.match(result.reason, /incomplete/);
    assert.equal(
      result.lines.some((line) => line.id === "2.x"),
      false,
    );
  });

  it("limits gap notes when release numbers are far apart", () => {
    const result = supportedVersions("pkg:npm/example", {
      asOf: "2026-11-15",
      rules: [
        rule("example.1", "vers:semver/>=1.0.0|<2.0.0", "2024-01-01"),
        rule("example.far", "vers:semver/>=1000000000.0.0|<1000000001.0.0", "2030-01-01"),
      ],
    });
    assert.equal(result.complete, false);
    assert.equal(result.notes.filter((note) => note.startsWith("No rule covers")).length, 20);
    assert.ok(result.notes.includes("Additional gaps in release-line coverage were omitted."));
  });

  it("returns an explicit empty answer for an unknown component", () => {
    const byPurl = supportedVersions("pkg:npm/not-a-real-ebb-package", { asOf: "2026-11-15" });
    assert.equal(byPurl.purl, "pkg:npm/not-a-real-ebb-package");
    assert.deepEqual(byPurl.lines, []);
    assert.equal(byPurl.complete, false);
    assert.equal(byPurl.recommendation, null);
    assert.ok(byPurl.notes.some((note) => note.includes("no rules")));

    const byName = supportedVersions("not-a-real-ebb-product", { asOf: "2026-11-15" });
    assert.equal(byName.purl, null);
    assert.deepEqual(byName.lines, []);
    assert.equal(byName.complete, false);
  });

  it("does not call an open, partial, or multi-line range a missing rule or a complete answer", () => {
    const open = supportedVersions("pkg:npm/example", {
      asOf: "2026-11-15",
      rules: [rule("example.open", "vers:semver/<18.0.0", "2024-01-01")],
    });
    assert.equal(open.complete, false);
    assert.deepEqual(open.lines, []);
    assert.equal(
      open.notes.some((note) => /no rules/i.test(note)),
      false,
    );
    assert.match(open.notes.join(" "), /single release line/);

    const partial = supportedVersions("pkg:npm/example", {
      asOf: "2026-11-15",
      rules: [rule("example.partial", "vers:semver/>=20.0.0", "2030-01-01")],
    });
    assert.equal(partial.complete, false);
    assert.deepEqual(partial.lines, []);
    assert.equal(
      partial.notes.some((note) => /no rules/i.test(note)),
      false,
    );
    assert.match(partial.reason, /release line/);

    const span = supportedVersions("pkg:npm/example", {
      asOf: "2026-11-15",
      rules: [
        rule("example.20", "vers:semver/>=20.0.0|<21.0.0", "2030-01-01"),
        rule("example.span", "vers:semver/>=20.0.0|<22.0.0", "2030-06-01"),
      ],
    });
    assert.deepEqual(
      span.lines.map((line) => line.id),
      ["20.x"],
    );
    assert.equal(span.complete, false);
    assert.equal(
      span.lines.some((line) => line.id === "21.x"),
      false,
    );
    assert.equal(
      span.notes.some((note) => note === "No rule covers 21.x."),
      false,
    );
    assert.equal(
      span.notes.some((note) => /no rule for versions newer than 20\.x/i.test(note)),
      false,
    );
    assert.match(span.notes.join(" "), /newer than 20\.x/);
  });

  it("resolves a bare name in a supplied rule list to one package, or reports ambiguity", () => {
    const shared = (id: string, purl: string, ecosystem: string, vers: string): RegistryV2Rule => ({
      ...rule(id, vers, "2030-01-01"),
      purl,
      ecosystem,
    });
    const ambiguous = [
      shared("npm.one", "pkg:npm/widget", "npm", "vers:semver/>=1.0.0|<2.0.0"),
      shared("pypi.one", "pkg:pypi/widget", "pypi", "vers:semver/>=1.0.0|<2.0.0"),
    ];
    assert.throws(
      () => supportedVersions("widget", { asOf: "2026-11-15", rules: ambiguous }),
      (error: unknown) => {
        assert.ok(error instanceof CheckError);
        assert.match(error.message, /Ambiguous product name "widget"/);
        assert.match(error.message, /pkg:npm\/widget/);
        assert.match(error.message, /pkg:pypi\/widget/);
        return true;
      },
    );

    const resolved = supportedVersions("widget", {
      asOf: "2026-11-15",
      rules: [
        shared("npm.one", "pkg:npm/widget", "npm", "vers:semver/>=1.0.0|<2.0.0"),
        shared("npm.two", "pkg:npm/widget", "npm", "vers:semver/>=2.0.0|<3.0.0"),
        shared("pypi.one", "pkg:pypi/widget", "pypi", "vers:semver/>=9.0.0|<10.0.0"),
      ],
    });
    assert.equal(resolved.purl, "pkg:npm/widget");
    assert.deepEqual(
      resolved.lines.map((line) => line.id),
      ["1.x", "2.x"],
    );
  });
});
