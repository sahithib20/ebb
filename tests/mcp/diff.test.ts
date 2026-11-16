import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { McpServer } from "../../src/mcp/index.js";
import type { McpToolResult } from "../../src/mcp/types.js";

describe("MCP diff tool", () => {
  const server = new McpServer();

  it("lists diff in tools/list", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    assert.ok(resp);
    const result = resp.result as { tools: Array<{ name: string }> };
    assert.ok(result.tools.some((t) => t.name === "diff"));
  });

  it("runs diff between bundled and active via tools/call (markdown)", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "diff",
        arguments: {
          from: "bundled",
          to: "active",
        },
      },
    });

    assert.ok(resp);
    const toolResult = resp.result as McpToolResult;
    assert.equal(toolResult.isError, false);
    assert.ok(toolResult.content[0]?.text.includes("# Ebb Lifecycle Data Diff"));
  });

  it("runs diff returning json format", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "diff",
        arguments: {
          from: "bundled",
          to: "active",
          format: "json",
          ecosystem: "npm",
        },
      },
    });

    assert.ok(resp);
    const toolResult = resp.result as McpToolResult;
    assert.equal(toolResult.isError, false);
    const parsed = JSON.parse(toolResult.content[0]?.text ?? "{}");
    assert.equal(parsed.schemaVersion, "ebb.data-diff.v1");
    assert.ok(parsed.summary);
  });

  it("returns error for invalid target", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "diff",
        arguments: {
          from: "nonexistent-version-xyz",
          to: "active",
        },
      },
    });

    assert.ok(resp);
    const toolResult = resp.result as McpToolResult;
    assert.equal(toolResult.isError, true);
    assert.ok(toolResult.content[0]?.text.includes("Error:"));
  });

  it("runs diff tool with since parameter and returns structured counts and changedRuleIds (release-log-9)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ebb-diff-since-"));
    const oldDir = process.env.EBB_DATA_DIR;
    process.env.EBB_DATA_DIR = tmp;
    try {
      const { appendReleaseLog } = await import("../../src/data-release-log.js");
      const version = "2026.11.11";
      const logContent = appendReleaseLog("", {
        version,
        contentDigest: `sha256:${"a".repeat(64)}`,
        bundleSha256: `sha256:${"b".repeat(64)}`,
        createdAt: "2026-11-11T12:00:00Z",
      });
      await mkdir(join(tmp, "data"), { recursive: true });
      await writeFile(join(tmp, "data", "release-log.jsonl"), logContent, "utf8");

      const versionDir = join(tmp, "data", version);
      await mkdir(versionDir, { recursive: true });
      const bundleData = {
        manifest: { version, schemaVersion: "ebb.data-bundle.v2" },
        files: {
          "registry/npm.json": {
            schemaVersion: "ebb.registry.v2",
            ecosystem: "npm",
            rules: [],
          },
        },
      };
      await writeFile(join(versionDir, "bundle.json"), JSON.stringify(bundleData), "utf8");

      const resp = await server.handleMessage({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "diff",
          arguments: {
            since: version,
          },
        },
      });

      assert.ok(resp);
      const toolResult = resp.result as McpToolResult;
      assert.equal(toolResult.isError, false);
      assert.ok(toolResult.structuredContent);
      const sc = toolResult.structuredContent as {
        counts?: { added: number; changed: number; removed: number };
        changedRuleIds?: { added: string[]; changed: string[]; removed: string[] };
      };
      assert.ok(sc.counts, "structuredContent must include counts");
      assert.ok(sc.changedRuleIds, "structuredContent must include changedRuleIds");
      assert.equal(typeof sc.counts.added, "number");
      assert.ok(Array.isArray(sc.changedRuleIds.added));
    } finally {
      if (oldDir !== undefined) process.env.EBB_DATA_DIR = oldDir;
      else delete process.env.EBB_DATA_DIR;
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
