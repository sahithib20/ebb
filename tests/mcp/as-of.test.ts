import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { McpServer } from "../../src/mcp/index.js";
import type { McpToolResult } from "../../src/mcp/types.js";

describe("MCP as_of date support for check and check_all", () => {
  const server = new McpServer();

  it("shows the same version answering differently before and after a deadline", async () => {
    // Before deadline: Node 22.11.0 on 2027-04-29 is scheduled
    const beforeResp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "check",
        arguments: {
          purl: "node",
          version: "22.11.0",
          as_of: "2027-04-29",
        },
      },
    });

    assert.ok(beforeResp && beforeResp.result);
    const beforeToolResult = beforeResp.result as McpToolResult;
    assert.equal(beforeToolResult.isError, false);
    const beforeParsed = JSON.parse(beforeToolResult.content[0]?.text ?? "{}");
    assert.equal(beforeParsed.status, "scheduled");
    assert.equal(beforeParsed.asOf, "2027-04-29");

    // After deadline: Node 22.11.0 on 2027-05-01 is end-of-life
    const afterResp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "check",
        arguments: {
          purl: "node",
          version: "22.11.0",
          as_of: "2027-05-01",
        },
      },
    });

    assert.ok(afterResp && afterResp.result);
    const afterToolResult = afterResp.result as McpToolResult;
    assert.equal(afterToolResult.isError, false);
    const afterParsed = JSON.parse(afterToolResult.content[0]?.text ?? "{}");
    assert.equal(afterParsed.status, "end-of-life");
    assert.equal(afterParsed.asOf, "2027-05-01");
  });

  it("answers batch check_all relative to as_of date", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "check_all",
        arguments: {
          items: [{ purl: "node", version: "22.11.0" }],
          as_of: "2027-05-01",
        },
      },
    });

    assert.ok(resp && resp.result);
    const toolResult = resp.result as McpToolResult;
    assert.equal(toolResult.isError, false);
    const parsed = JSON.parse(toolResult.content[0]?.text ?? "{}");
    assert.equal(parsed.results[0].status, "end-of-life");
    assert.equal(parsed.results[0].asOf, "2027-05-01");
  });

  it("rejects malformed date in check tool", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "check",
        arguments: {
          purl: "node",
          version: "22.11.0",
          as_of: "not-a-valid-date",
        },
      },
    });

    assert.ok(resp && resp.result);
    const toolResult = resp.result as McpToolResult;
    assert.equal(toolResult.isError, true);
    assert.ok(toolResult.content[0]?.text.includes("must be a valid date"));
  });

  it("rejects malformed date in check_all tool", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "check_all",
        arguments: {
          items: ["pkg:npm/request@2.88.2"],
          as_of: "2026-02-30",
        },
      },
    });

    assert.ok(resp && resp.result);
    const toolResult = resp.result as McpToolResult;
    assert.equal(toolResult.isError, true);
    assert.ok(toolResult.content[0]?.text.includes("must be a valid date"));
  });
});
