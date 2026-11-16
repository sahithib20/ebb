import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { McpServer } from "../../src/mcp/index.js";
import type { FormattedCheckResult } from "../../src/mcp/format.js";

describe("MCP confidence reporting", () => {
  const server = new McpServer();

  it("shows level and note for a tentative rule and advises verification", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "check",
        arguments: {
          purl: "pkg:generic/redis@5.0.0",
        },
      },
    });

    assert.ok(resp);
    const result = resp.result as { content: Array<{ type: string; text: string }> };
    assert.ok(result.content && result.content[0]);
    const parsed: FormattedCheckResult = JSON.parse(result.content[0].text);

    // Tentative finding must not be dropped
    assert.ok(parsed.matches.length > 0);
    const tentativeMatch = parsed.matches.find((m) => m.ruleId === "database.redis.end-of-life-5.0");
    assert.ok(tentativeMatch, "database.redis.end-of-life-5.0 finding must be present");

    // Level and note present
    assert.equal(tentativeMatch.confidence, "tentative");
    assert.ok(
      typeof tentativeMatch.confidenceNote === "string" && tentativeMatch.confidenceNote.length > 0,
      "tentativeMatch must have a confidenceNote",
    );

    // Tells the agent in plain words to verify before acting
    assert.ok(
      tentativeMatch.verificationAdvice && /verify/i.test(tentativeMatch.verificationAdvice),
      "finding must tell agent to verify before acting",
    );
    assert.ok(
      parsed.verificationAdvice && /verify/i.test(parsed.verificationAdvice),
      "result must tell agent in plain words to verify tentative findings",
    );
  });

  it("reports confirmed confidence on confirmed rules without tentative warnings", async () => {
    const resp = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "check",
        arguments: {
          purl: "pkg:npm/request@2.88.2",
        },
      },
    });

    assert.ok(resp);
    const result = resp.result as { content: Array<{ type: string; text: string }> };
    const parsed: FormattedCheckResult = JSON.parse(result.content[0]!.text);
    assert.ok(parsed.matches.length > 0);
    assert.equal(parsed.matches[0]?.confidence, "confirmed");
    assert.equal(parsed.verificationAdvice, undefined);
  });
});
