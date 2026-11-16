import { sourcesOf } from "../../index.js";
import type { McpTool, McpToolResult } from "../types.js";
import { isIsoDate } from "../../registry.js";

export const sourcesTool: McpTool = {
  definition: {
    name: "sources_of",
    description:
      'Call to inspect authoritative sources, archive snapshot URLs, health status, and review provenance for a lifecycle rule. Example: {"ruleId":"npm.package.request.deprecated"}.',
    inputSchema: {
      type: "object",
      properties: {
        ruleId: {
          type: "string",
          description: "ID of the lifecycle rule (e.g. 'npm.package.request.deprecated').",
        },
        as_of: {
          type: "string",
          description: "Optional reference date in YYYY-MM-DD format for time-travel evaluation.",
        },
        asOf: {
          type: "string",
          description: "Alias for as_of.",
        },
      },
      required: ["ruleId"],
    },
    outputSchema: {
      type: "object",
      properties: {
        ruleId: { type: "string" },
        purl: { type: "string" },
        ecosystem: { type: "string" },
        name: { type: "string" },
        status: { type: "string" },
        sources: { type: "array" },
        reviewer: { type: ["string", "null"] },
        reviewedAt: { type: ["string", "null"] },
      },
      required: ["ruleId", "sources"],
    },
  },
  handler: (args: Record<string, unknown>): McpToolResult => {
    const ruleId = typeof args.ruleId === "string" ? args.ruleId.trim() : "";
    if (!ruleId) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Missing required parameter 'ruleId'.",
          },
        ],
        isError: true,
      };
    }

    const asOfArg =
      typeof args.as_of === "string" ? args.as_of.trim() : typeof args.asOf === "string" ? args.asOf.trim() : undefined;

    if (asOfArg !== undefined && !isIsoDate(asOfArg)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: 'as_of' must be a valid date (YYYY-MM-DD), got "${asOfArg}".`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = sourcesOf(ruleId, { asOf: asOfArg });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
        isError: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  },
};
