import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { supportedVersions } from "../../src/pick-version.js";
import * as root from "../../src/index.js";

describe("supportedVersions signature", () => {
  it("stays off the package root until the export issue", () => {
    const result = supportedVersions("pkg:npm/not-a-real-ebb-package", { asOf: "2026-11-15" });
    assert.equal(result.asOf, "2026-11-15");
    assert.equal(result.complete, false);
    assert.equal("supportedVersions" in root, false);
  });
});
