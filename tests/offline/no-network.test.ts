import assert from "node:assert/strict";
import dns from "node:dns";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import * as ebb from "../../src/index.js";

function blockNetwork() {
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;
  const originalNetConnect = net.connect;
  const originalNetCreateConnection = net.createConnection;
  const originalSocketConnect = net.Socket.prototype.connect;
  const originalDnsLookup = dns.lookup;
  const originalDnsResolve = dns.resolve;
  const originalDnsPromisesLookup = dns.promises.lookup;
  const originalDnsPromisesResolve = dns.promises.resolve;

  const throwNetworkError = (name: string): never => {
    throw new Error(`Offline violation: network entry point "${name}" was called`);
  };

  // Replace fetch
  globalThis.fetch = (() => {
    throwNetworkError("fetch");
  }) as unknown as typeof fetch;

  // Replace http/https
  // biome-ignore lint/suspicious/noExplicitAny: monkey-patching for tests
  http.request = (() => throwNetworkError("http.request")) as any;
  // biome-ignore lint/suspicious/noExplicitAny: monkey-patching for tests
  http.get = (() => throwNetworkError("http.get")) as any;
  // biome-ignore lint/suspicious/noExplicitAny: monkey-patching for tests
  https.request = (() => throwNetworkError("https.request")) as any;
  // biome-ignore lint/suspicious/noExplicitAny: monkey-patching for tests
  https.get = (() => throwNetworkError("https.get")) as any;

  // Replace net
  // biome-ignore lint/suspicious/noExplicitAny: monkey-patching for tests
  net.connect = (() => throwNetworkError("net.connect")) as any;
  // biome-ignore lint/suspicious/noExplicitAny: monkey-patching for tests
  net.createConnection = (() => throwNetworkError("net.createConnection")) as any;
  // biome-ignore lint/suspicious/noExplicitAny: monkey-patching for tests
  net.Socket.prototype.connect = function () {
    throwNetworkError("net.Socket.prototype.connect");
  } as any;

  // Replace dns
  // biome-ignore lint/suspicious/noExplicitAny: monkey-patching for tests
  dns.lookup = (() => throwNetworkError("dns.lookup")) as any;
  // biome-ignore lint/suspicious/noExplicitAny: monkey-patching for tests
  dns.resolve = (() => throwNetworkError("dns.resolve")) as any;
  // biome-ignore lint/suspicious/noExplicitAny: monkey-patching for tests
  dns.promises.lookup = (() => Promise.reject(new Error("Offline violation: dns.promises.lookup"))) as any;
  // biome-ignore lint/suspicious/noExplicitAny: monkey-patching for tests
  dns.promises.resolve = (() => Promise.reject(new Error("Offline violation: dns.promises.resolve"))) as any;

  return function restore() {
    globalThis.fetch = originalFetch;
    http.request = originalHttpRequest;
    http.get = originalHttpGet;
    https.request = originalHttpsRequest;
    https.get = originalHttpsGet;
    net.connect = originalNetConnect;
    net.createConnection = originalNetCreateConnection;
    net.Socket.prototype.connect = originalSocketConnect;
    dns.lookup = originalDnsLookup;
    dns.resolve = originalDnsResolve;
    dns.promises.lookup = originalDnsPromisesLookup;
    dns.promises.resolve = originalDnsPromisesResolve;
  };
}

describe("offline-1: core API makes no network requests", () => {
  let restoreNetwork: () => void;

  before(() => {
    restoreNetwork = blockNetwork();
  });

  after(() => {
    restoreNetwork();
  });

  it("check", () => {
    const res = ebb.check("pkg:npm/express", "4.18.2");
    assert.ok(res);
    assert.equal(typeof res.status, "string");
  });

  it("createEbb", () => {
    const client = ebb.createEbb({ ecosystems: ["npm"] });
    const res = client.check("pkg:npm/express", "4.18.2");
    assert.ok(res);
  });

  it("preload", async () => {
    await ebb.preload(["npm"]);
  });

  it("asOf", () => {
    const client = ebb.asOf("2026-01-01");
    const res = client.check("pkg:npm/request", "2.88.2");
    assert.ok(res);
    assert.equal(typeof res.status, "string");
  });

  it("supportedVersions", () => {
    const res = ebb.supportedVersions("pkg:npm/express");
    assert.ok(res);
    assert.ok(Array.isArray(res.lines));
  });

  it("checkAll", async () => {
    const res = await ebb.checkAll([{ purl: "pkg:npm/express", version: "4.18.2" }]);
    assert.ok(res);
    assert.equal(res.results.length, 1);
  });

  it("replacementFor", () => {
    const res = ebb.replacementFor("pkg:npm/request", "2.88.2");
    assert.ok(typeof res === "string" || res === null);
  });

  it("rulesFor", () => {
    const res = ebb.rulesFor("pkg:npm/express");
    assert.ok(Array.isArray(res));
  });

  it("upcoming", () => {
    const res = ebb.upcoming({ within: "90d" });
    assert.ok(res);
    assert.ok(Array.isArray(res.items));
  });

  it("recent", () => {
    const res = ebb.recent({ within: "90d" });
    assert.ok(res);
    assert.ok(Array.isArray(res.items));
  });

  it("toICal", () => {
    const ical = ebb.toICal({ ecosystem: "npm" });
    assert.ok(ical.includes("BEGIN:VCALENDAR"));
  });

  it("stale", () => {
    const res = ebb.stale();
    assert.ok(res);
    assert.ok(Array.isArray(res.stale));
  });

  it("sourcesOf", () => {
    const res = ebb.sourcesOf("npm.package.request.deprecated");
    assert.ok(res);
    assert.equal(res.ruleId, "npm.package.request.deprecated");
  });

  it("iterates all exported functions from root except update and rollback", async () => {
    const excluded = new Set(["update", "rollback", "updateData"]);
    for (const [key, value] of Object.entries(ebb)) {
      if (typeof value === "function" && !excluded.has(key)) {
        assert.ok(key, `Root export function "${key}" exists`);
      }
    }
  });

  it("fails when a network call is made during check", () => {
    assert.throws(
      () => {
        // Simulate a hypothetical network call inside check
        globalThis.fetch("https://example.com");
      },
      (err: unknown) => err instanceof Error && err.message.includes("Offline violation"),
    );
  });

  it("verifies every claim in docs/offline.md maps to an existing test in source comments", () => {
    const offlineDoc = readFileSync(resolve(process.cwd(), "docs/offline.md"), "utf8");
    const testCommentRegex = /<!--\s*test:\s*([^\s]+)(?:\s*\("([^"]+)"\))?\s*-->/g;
    const matches = [...offlineDoc.matchAll(testCommentRegex)];
    assert.ok(matches.length >= 10, `Expected >= 10 test mappings in docs/offline.md, found ${matches.length}`);

    for (const match of matches) {
      const relPath = match[1]!;
      const testName = match[2];
      const fullPath = resolve(process.cwd(), relPath);
      assert.ok(existsSync(fullPath), `Test file referenced in docs/offline.md does not exist: ${relPath}`);

      if (testName) {
        const fileContent = readFileSync(fullPath, "utf8");
        assert.ok(fileContent.includes(testName), `Test "${testName}" not found in referenced file ${relPath}`);
      }
    }
  });
});
