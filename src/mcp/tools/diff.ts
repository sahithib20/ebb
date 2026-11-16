import { diff, formatDiffMarkdown } from "../../diff.js";
import type { McpTool, McpToolResult } from "../types.js";

export const diffTool: McpTool = {
  definition: {
    name: "diff",
    description:
      'Call to compare two lifecycle data versions, dates, files, or active data and inspect added, changed, or removed rules. Example: {"from":"2026.10.01","to":"active"}.',
    inputSchema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description:
            "Starting version, date (YYYY-MM-DD), bundle file path, 'bundled', or 'active' (default: 'bundled').",
        },
        to: {
          type: "string",
          description: "Target version, date (YYYY-MM-DD), bundle file path, or 'active' (default: 'active').",
        },
        ecosystem: {
          type: "string",
          description: "Optional ecosystem filter (e.g. 'npm', 'pypi', 'go').",
        },
        format: {
          type: "string",
          enum: ["markdown", "json"],
          description: "Output format: 'markdown' (default) or 'json'.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        from: { type: "object" },
        to: { type: "object" },
        summary: { type: "object" },
        added: { type: "array" },
        changed: { type: "array" },
        removed: { type: "array" },
        renamed: { type: "array" },
      },
      required: ["from", "to", "summary"],
    },
  },
  handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
    const from = typeof args.from === "string" && args.from.trim() ? args.from.trim() : undefined;
    const to = typeof args.to === "string" && args.to.trim() ? args.to.trim() : undefined;
    const ecosystem = typeof args.ecosystem === "string" && args.ecosystem.trim() ? args.ecosystem.trim() : undefined;
    const format = typeof args.format === "string" ? args.format.toLowerCase() : "markdown";

    try {
      const result = await diff(from, to, { ecosystem });
      if (format === "json") {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
          isError: false,
        };
      }
      return {
        content: [{ type: "text", text: formatDiffMarkdown(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
        isError: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  },
};
