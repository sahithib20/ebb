import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { McpServer } from "../../src/mcp/index.js";

describe("MCP tool contract: code, server.json and docs agree", () => {
  const server = new McpServer();
  const serverJsonPath = resolve(process.cwd(), "server.json");
  const docsMcpPath = resolve(process.cwd(), "docs/mcp.md");

  it("every registered tool and resource appears in server.json and docs/mcp.md", async () => {
    // 1. Get registered tools and resources
    const toolsResp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    assert.ok(toolsResp && toolsResp.result);
    const registeredTools = (toolsResp.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name).sort();

    const resResp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/list",
    });
    assert.ok(resResp && resResp.result);
    const registeredResources = (resResp.result as { resources: Array<{ uri: string }> }).resources
      .map((r) => r.uri)
      .sort();

    // 2. Inspect server.json
    const serverJson = JSON.parse(readFileSync(serverJsonPath, "utf8")) as {
      _meta?: {
        "io.modelcontextprotocol.registry/publisher-provided"?: {
          tools?: string[];
        };
      };
    };
    const serverJsonTools = [
      ...(serverJson._meta?.["io.modelcontextprotocol.registry/publisher-provided"]?.tools ?? []),
    ].sort();

    for (const tool of registeredTools) {
      assert.ok(
        serverJsonTools.includes(tool),
        `Tool "${tool}" is registered in code but missing from server.json publisher-provided tools`,
      );
    }
    assert.deepEqual(serverJsonTools, registeredTools, "server.json tools must match registered tools exactly");

    // 3. Inspect docs/mcp.md
    const docs = readFileSync(docsMcpPath, "utf8");

    for (const tool of registeredTools) {
      // Must appear in the tools table
      assert.ok(
        docs.includes(`| \`${tool}\` |`) || docs.includes(`| \`${tool}\`  |`),
        `Tool "${tool}" must be listed in the tools table in docs/mcp.md`,
      );
      // Must have its own heading section
      assert.ok(
        docs.includes(`### \`${tool}\``),
        `Tool "${tool}" must have a documentation heading '### \`${tool}\`' in docs/mcp.md`,
      );
    }

    for (const res of registeredResources) {
      assert.ok(
        docs.includes(`### \`${res}\``),
        `Resource "${res}" must be documented with '### \`${res}\`' in docs/mcp.md`,
      );
    }
  });
});
