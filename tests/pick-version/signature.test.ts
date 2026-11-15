import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { supportedVersions } from "../../src/pick-version.js";
import * as root from "../../src/index.js";

describe("supportedVersions signature", () => {
  it("returns the empty typed answer and is not a package-root export yet", () => {
    const result = supportedVersions("pkg:npm/left-pad", { asOf: "2026-11-15" });
    assert.equal(result.purl, "pkg:npm/left-pad");
    assert.equal(result.asOf, "2026-11-15");
    assert.deepEqual(result.lines, []);
    assert.equal(result.recommendation, null);
    assert.equal(result.complete, false);
    assert.equal("supportedVersions" in root, false);
    assert.equal(supportedVersions("node").purl, null);
  });
});
