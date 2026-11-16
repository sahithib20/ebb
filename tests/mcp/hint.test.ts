import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { McpServer } from "../../src/mcp/index.js";
import type { McpToolResult } from "../../src/mcp/types.js";

describe("Offing remediation hint removed from MCP tools", () => {
  const server = new McpServer();

  it("does not include hint in check tool when package is deprecated", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "check",
        arguments: {
          purl: "pkg:npm/request@2.88.2",
        },
      },
    });

    assert.ok(resp && resp.result);
    const toolResult = resp.result as McpToolResult;
    const content = toolResult.content;
    const parsed = JSON.parse(content[0]?.text ?? "{}");
    assert.equal(parsed.status, "deprecated");
    assert.equal(parsed.hint, undefined);
    assert.equal(content[0]?.text.includes("Offing"), false);
    assert.equal((toolResult.structuredContent as Record<string, unknown> | undefined)?.hint, undefined);
  });

  it("does not include hint in check_all batch tool for affected items and batch summary", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "check_all",
        arguments: {
          items: ["pkg:npm/request@2.88.2"],
        },
      },
    });

    assert.ok(resp && resp.result);
    const toolResult = resp.result as McpToolResult;
    const content = toolResult.content;
    const parsed = JSON.parse(content[0]?.text ?? "{}");
    assert.equal(parsed.hint, undefined);
    assert.equal(parsed.results[0].hint, undefined);
    assert.equal(content[0]?.text.includes("Offing"), false);
    assert.equal((toolResult.structuredContent as Record<string, unknown> | undefined)?.hint, undefined);
  });
});
