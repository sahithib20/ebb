import { upcoming } from "../../index.js";
import type { McpTool, McpToolResult } from "../types.js";
import { isIsoDate } from "../../registry.js";

export const upcomingTool: McpTool = {
  definition: {
    name: "upcoming",
    description:
      'Call before planning upgrades to list scheduled deprecation and end-of-life deadlines within a time window. Example: {"within":"90d","ecosystem":"npm"}.',
    inputSchema: {
      type: "object",
      properties: {
        within: {
          type: "string",
          description: "Time window (e.g. '30d', '6m', '1y', default '10y').",
        },
        ecosystem: {
          type: "string",
          description: "Optional ecosystem filter (e.g. 'npm', 'python', 'go', 'ci-images').",
        },
        purl: {
          type: "string",
          description: "Optional package URL or product name filter (e.g. 'pkg:generic/nodejs').",
        },
        as_of: {
          type: "string",
          description: "Optional reference date in YYYY-MM-DD format.",
        },
        asOf: {
          type: "string",
          description: "Alias for as_of.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        asOf: { type: "string" },
        count: { type: "number" },
        events: { type: "array" },
      },
      required: ["asOf", "count", "events"],
    },
  },
  handler: (args: Record<string, unknown>): McpToolResult => {
    const within = typeof args.within === "string" ? args.within.trim() : undefined;
    const ecosystem = typeof args.ecosystem === "string" ? args.ecosystem.trim() : undefined;
    const purl = typeof args.purl === "string" ? args.purl.trim() : undefined;
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
      const res = upcoming({
        within,
        ecosystem,
        purls: purl ? [purl] : undefined,
        asOf: asOfArg,
      });

      const result = {
        asOf: res.asOf,
        count: res.count,
        events: res.items.map((it) => ({
          ruleId: it.ruleId,
          purl: it.purl,
          event: it.event,
          deadline: it.deadline,
          daysLeft: it.daysLeft,
          replacement: it.replacement,
          sources: it.sources.map((s) => ({ url: s.url })),
          reviewedAt: it.reviewedAt,
        })),
      };

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
            text: `Error fetching upcoming events: ${message}`,
          },
        ],
        isError: true,
      };
    }
  },
};
