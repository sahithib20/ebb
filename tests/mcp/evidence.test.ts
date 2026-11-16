import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { McpServer } from "../../src/mcp/index.js";
import type { McpToolResult } from "../../src/mcp/types.js";

describe("MCP evidence in every verdict", () => {
  const server = new McpServer();

  it("deprecated package answer carries ruleId, source URL, review date and data version in text and structured output", async () => {
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
    assert.equal(toolResult.isError, false);

    // Text output inspection
    const text = toolResult.content[0]?.text ?? "";
    const parsed = JSON.parse(text);

    assert.equal(parsed.status, "deprecated");
    assert.ok(typeof parsed.dataVersion === "string" && parsed.dataVersion.length > 0);
    assert.ok(parsed.matches.length > 0);

    const match = parsed.matches[0];
    assert.equal(match.ruleId, "npm.package.request.deprecated");
    assert.ok(Array.isArray(match.sources) && match.sources.length > 0);
    assert.ok(match.sources[0].url.startsWith("https://"));
    assert.ok(typeof match.reviewedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(match.reviewedAt));

    // Structured content inspection
    assert.ok(toolResult.structuredContent);
    const structured = toolResult.structuredContent as typeof parsed;
    assert.equal(structured.status, "deprecated");
    assert.equal(structured.dataVersion, parsed.dataVersion);
    assert.ok(structured.matches.length > 0);

    const structuredMatch = structured.matches[0];
    assert.equal(structuredMatch.ruleId, "npm.package.request.deprecated");
    assert.ok(Array.isArray(structuredMatch.sources) && structuredMatch.sources.length > 0);
    assert.ok(structuredMatch.sources[0].url.startsWith("https://"));
    assert.equal(structuredMatch.sources[0].url, match.sources[0].url);
    assert.equal(structuredMatch.reviewedAt, match.reviewedAt);
  });
});
