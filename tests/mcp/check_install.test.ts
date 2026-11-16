import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { McpServer } from "../../src/mcp/index.js";
import { parseInstallCommand, tokenizeCommandLine } from "../../src/mcp/tools/check_install.js";
import type { McpToolResult } from "../../src/mcp/types.js";

describe("check_install command parsing", () => {
  it("tokenizes commands with spaces and quotes", () => {
    const tokens = tokenizeCommandLine("npm install \"left-pad@1.3.0\" 'request@2.88.2'");
    assert.deepEqual(tokens, ["npm", "install", "left-pad@1.3.0", "request@2.88.2"]);
  });

  it("parses npm install with scoped packages and version ranges", () => {
    const parsed = parseInstallCommand("npm install @types/node@^18.0.0 express@4.18.2");
    assert.equal(parsed.ecosystem, "npm");
    assert.deepEqual(parsed.items, [
      { purl: "pkg:npm/%40types/node", version: "^18.0.0" },
      { purl: "pkg:npm/express", version: "4.18.2" },
    ]);
  });

  it("parses pnpm add with flags", () => {
    const parsed = parseInstallCommand("pnpm add -D left-pad@1.3.0");
    assert.equal(parsed.ecosystem, "npm");
    assert.deepEqual(parsed.items, [{ purl: "pkg:npm/left-pad", version: "1.3.0" }]);
  });

  it("parses yarn add", () => {
    const parsed = parseInstallCommand("yarn add request@2.88.2");
    assert.equal(parsed.ecosystem, "npm");
    assert.deepEqual(parsed.items, [{ purl: "pkg:npm/request", version: "2.88.2" }]);
  });

  it("parses bun add", () => {
    const parsed = parseInstallCommand("bun add react@18.2.0");
    assert.equal(parsed.ecosystem, "npm");
    assert.deepEqual(parsed.items, [{ purl: "pkg:npm/react", version: "18.2.0" }]);
  });

  it("parses pip install with version ranges and exact pins", () => {
    const parsed = parseInstallCommand("pip install requests==2.31.0 'flask>=2.0'");
    assert.equal(parsed.ecosystem, "pypi");
    assert.deepEqual(parsed.items, [
      { purl: "pkg:pypi/requests", version: "2.31.0" },
      { purl: "pkg:pypi/flask", version: ">=2.0" },
    ]);
  });

  it("parses cargo add with @ syntax and --version flag", () => {
    const parsedAt = parseInstallCommand("cargo add tokio@1.0");
    assert.equal(parsedAt.ecosystem, "cargo");
    assert.deepEqual(parsedAt.items, [{ purl: "pkg:cargo/tokio", version: "1.0" }]);

    const parsedFlag = parseInstallCommand("cargo add serde --version 1.0.197");
    assert.equal(parsedFlag.ecosystem, "cargo");
    assert.deepEqual(parsedFlag.items, [{ purl: "pkg:cargo/serde", version: "1.0.197" }]);
  });

  it("parses go get with module paths and version tags", () => {
    const parsed = parseInstallCommand("go get golang.org/x/crypto@v0.1.0");
    assert.equal(parsed.ecosystem, "golang");
    assert.deepEqual(parsed.items, [{ purl: "pkg:golang/golang.org/x/crypto", version: "v0.1.0" }]);
  });

  it("throws clear error on unparseable or unsupported command", () => {
    assert.throws(() => parseInstallCommand("brew install node"), /Unsupported install command/);
    assert.throws(() => parseInstallCommand("npm run test"), /Unrecognized npm subcommand/);
    assert.throws(() => parseInstallCommand(""), /Command cannot be empty/);
  });
});

describe("MCP check_install tool", () => {
  const server = new McpServer();

  it("evaluates npm install command with deprecated and healthy packages", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "check_install",
        arguments: {
          command: "npm install request@2.88.2 express@4.18.2",
        },
      },
    });

    assert.ok(resp && resp.result);
    const toolResult = resp.result as McpToolResult;
    assert.equal(toolResult.isError, false);

    const parsed = JSON.parse(toolResult.content[0]?.text ?? "{}");
    assert.equal(parsed.command, "npm install request@2.88.2 express@4.18.2");
    assert.equal(parsed.packages.length, 2);
    assert.equal(parsed.results.length, 2);
    assert.equal(parsed.summary.total, 2);

    const reqResult = parsed.results[0];
    assert.equal(reqResult.status, "deprecated");

    // Structured content
    assert.ok(toolResult.structuredContent);
    assert.equal(toolResult.structuredContent.command, "npm install request@2.88.2 express@4.18.2");
    assert.equal((toolResult.structuredContent.results as Array<{ purl: string }>).length, 2);
  });

  it("returns error on unparseable install command", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "check_install",
        arguments: {
          command: "unsupported-tool install foo",
        },
      },
    });

    assert.ok(resp && resp.result);
    const toolResult = resp.result as McpToolResult;
    assert.equal(toolResult.isError, true);
    assert.ok(toolResult.content[0]?.text.includes("Unsupported install command"));
  });

  it("supports as_of date parameter", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "check_install",
        arguments: {
          command: "npm install request@2.88.2",
          as_of: "2026-11-15",
        },
      },
    });

    assert.ok(resp && resp.result);
    const toolResult = resp.result as McpToolResult;
    assert.equal(toolResult.isError, false);
    const parsed = JSON.parse(toolResult.content[0]?.text ?? "{}");
    assert.equal(parsed.results[0].asOf, "2026-11-15");
  });
});
