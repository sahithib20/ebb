import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { McpServer } from "../../src/mcp/index.js";
import type { McpToolResult } from "../../src/mcp/types.js";

describe("MCP upcoming tool", () => {
  const server = new McpServer();

  it("lists upcoming tool in tools/list", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    assert.ok(resp && resp.result);
    const tools = (resp.result as { tools: Array<{ name: string }> }).tools;
    assert.ok(tools.some((t) => t.name === "upcoming"));
  });

  it("returns upcoming events for default window", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "upcoming",
        arguments: {
          as_of: "2026-01-01",
        },
      },
    });

    assert.ok(resp && resp.result);
    const toolResult = resp.result as McpToolResult;
    assert.equal(toolResult.isError, false);

    const parsed = JSON.parse(toolResult.content[0]?.text ?? "{}");
    assert.ok(parsed.count > 0);
    assert.equal(parsed.asOf, "2026-01-01");
    assert.ok(Array.isArray(parsed.events));
    assert.ok(parsed.events.length > 0);

    // Structured content check
    assert.ok(toolResult.structuredContent);
    assert.equal(toolResult.structuredContent.count, parsed.count);
    assert.equal(toolResult.structuredContent.asOf, "2026-01-01");
  });

  it("filters by ecosystem", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "upcoming",
        arguments: {
          ecosystem: "database",
          as_of: "2026-01-01",
        },
      },
    });

    assert.ok(resp && resp.result);
    const toolResult = resp.result as McpToolResult;
    assert.equal(toolResult.isError, false);

    const parsed = JSON.parse(toolResult.content[0]?.text ?? "{}");
    assert.ok(parsed.count > 0);
    for (const ev of parsed.events) {
      assert.ok(ev.ruleId.startsWith("database."));
    }
  });

  it("returns empty result when no events match window or filter", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "upcoming",
        arguments: {
          ecosystem: "nonexistent-fake-ecosystem",
          as_of: "2026-01-01",
        },
      },
    });

    assert.ok(resp && resp.result);
    const toolResult = resp.result as McpToolResult;
    assert.equal(toolResult.isError, false);

    const parsed = JSON.parse(toolResult.content[0]?.text ?? "{}");
    assert.equal(parsed.count, 0);
    assert.deepEqual(parsed.events, []);
    assert.deepEqual(toolResult.structuredContent?.events, []);
  });

  it("rejects invalid as_of date parameter", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "upcoming",
        arguments: {
          as_of: "invalid-date",
        },
      },
    });

    assert.ok(resp && resp.result);
    const toolResult = resp.result as McpToolResult;
    assert.equal(toolResult.isError, true);
    assert.ok(toolResult.content[0]?.text.includes("must be a valid date"));
  });
});
