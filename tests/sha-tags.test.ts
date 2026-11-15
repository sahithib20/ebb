import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { versContains } from "../src/vers.js";
import { chooseTag } from "../tools/sha-tags.js";

const sha = "a".repeat(40);

test("two tags in one major keep the higher tag, whatever the order", () => {
  assert.equal(chooseTag("actions/stale", sha, "v1.0.2", "v1.0.1"), "v1.0.2");
  assert.equal(chooseTag("actions/stale", sha, "v1.0.1", "v1.0.2"), "v1.0.2");
  assert.equal(chooseTag("actions/stale", sha, "v2.9.0", "v2.10.0"), "v2.10.0");
  assert.equal(chooseTag("actions/stale", sha, "v2.10.0", "v2.9.9"), "v2.10.0");
});

test("tags in different majors for one commit are an error", () => {
  assert.throws(() => chooseTag("actions/stale", sha, "v1.9.0", "v2.0.0"), /conflicting tags v1\.9\.0 and v2\.0\.0/);
});

test("anything but an exact release tag is rejected", () => {
  assert.throws(() => chooseTag("actions/stale", sha, "v1", "v1.0.0"), /Not an exact release tag/);
});

test("the SHA map stays out of the npm package", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as { files: string[] };
  assert.ok(pkg.files.includes("!registry/github-actions-shas.json"));
});

test("a pinned SHA of each newly covered retired major matches that action's end rule", async () => {
  const map = JSON.parse(await readFile("registry/github-actions-shas.json", "utf8")) as {
    actions: Record<string, Record<string, string>>;
  };
  const samples = [
    { action: "actions/ai-inference", major: 1, later: 2, vers: "vers:semver/<2.0.0" },
    { action: "actions/attest", major: 2, later: 3, vers: "vers:semver/<3.0.0" },
    { action: "actions/delete-package-versions", major: 5, later: 6, vers: "vers:semver/>=5.0.0|<6.0.0" },
    { action: "actions/dependency-review-action", major: 4, later: 5, vers: "vers:semver/>=4.0.0|<5.0.0" },
    { action: "actions/go-dependency-submission", major: 2, later: 3, vers: "vers:semver/>=2.0.0|<3.0.0" },
  ];
  for (const sample of samples) {
    const entries = Object.entries(map.actions[sample.action] ?? {});
    const hit = entries.find(([, tag]) => tag.startsWith(`v${sample.major}.`));
    assert.ok(hit, `${sample.action} is missing a pinned v${sample.major} release`);
    const [pinned, tag] = hit;
    assert.match(pinned, /^[0-9a-f]{40}$/);
    assert.equal(versContains(sample.vers, tag.slice(1)), true, `${sample.action}@${tag}`);
    const later = entries.find(([, candidate]) => candidate.startsWith(`v${sample.later}.`));
    if (later) assert.equal(versContains(sample.vers, later[1].slice(1)), false);
  }
});
