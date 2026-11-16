import { asOf, checkAll, type CheckAllItem } from "../../index.js";
import { formatCheckAllResult } from "../format.js";
import type { McpTool, McpToolResult } from "../types.js";
import { isIsoDate } from "../../registry.js";

export function tokenizeCommandLine(cmd: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i]!;
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (/\s/.test(char) && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

export function parseInstallCommand(command: string): { items: CheckAllItem[]; ecosystem: string } {
  const rawTokens = tokenizeCommandLine(command.trim());
  if (rawTokens.length === 0) {
    throw new Error("Command cannot be empty.");
  }

  // Strip leading sudo or npx if present
  let tokens = rawTokens;
  if (tokens[0] === "sudo") {
    tokens = tokens.slice(1);
  }
  if (tokens[0] === "npx") {
    tokens = tokens.slice(1);
  }

  if (tokens.length === 0) {
    throw new Error("Command cannot be empty after stripping wrappers.");
  }

  const tool = tokens[0]?.toLowerCase();
  let ecosystem = "";
  let pkgTokens: string[] = [];

  if (tool === "npm") {
    const sub = tokens[1]?.toLowerCase();
    if (sub === "install" || sub === "i" || sub === "add") {
      ecosystem = "npm";
      pkgTokens = tokens.slice(2);
    } else {
      throw new Error(`Unrecognized npm subcommand "${sub}". Expected "install", "i", or "add".`);
    }
  } else if (tool === "pnpm") {
    const sub = tokens[1]?.toLowerCase();
    if (sub === "add" || sub === "install" || sub === "i") {
      ecosystem = "npm";
      pkgTokens = tokens.slice(2);
    } else {
      throw new Error(`Unrecognized pnpm subcommand "${sub}". Expected "add", "install", or "i".`);
    }
  } else if (tool === "yarn") {
    const sub = tokens[1]?.toLowerCase();
    if (sub === "add") {
      ecosystem = "npm";
      pkgTokens = tokens.slice(2);
    } else {
      throw new Error(`Unrecognized yarn subcommand "${sub}". Expected "add".`);
    }
  } else if (tool === "bun") {
    const sub = tokens[1]?.toLowerCase();
    if (sub === "add" || sub === "i" || sub === "install") {
      ecosystem = "npm";
      pkgTokens = tokens.slice(2);
    } else {
      throw new Error(`Unrecognized bun subcommand "${sub}". Expected "add", "i", or "install".`);
    }
  } else if (tool === "pip" || tool === "pip3") {
    const sub = tokens[1]?.toLowerCase();
    if (sub === "install") {
      ecosystem = "pypi";
      pkgTokens = tokens.slice(2);
    } else {
      throw new Error(`Unrecognized pip subcommand "${sub}". Expected "install".`);
    }
  } else if (tool === "cargo") {
    const sub = tokens[1]?.toLowerCase();
    if (sub === "add") {
      ecosystem = "cargo";
      pkgTokens = tokens.slice(2);
    } else {
      throw new Error(`Unrecognized cargo subcommand "${sub}". Expected "add".`);
    }
  } else if (tool === "go") {
    const sub = tokens[1]?.toLowerCase();
    if (sub === "get") {
      ecosystem = "golang";
      pkgTokens = tokens.slice(2);
    } else {
      throw new Error(`Unrecognized go subcommand "${sub}". Expected "get".`);
    }
  } else {
    throw new Error(
      `Unsupported install command "${tool}". Supported package managers: npm, pnpm, yarn, bun add, pip install, cargo add, go get.`,
    );
  }

  const items: CheckAllItem[] = [];
  let explicitCargoVersion: string | undefined;

  for (let i = 0; i < pkgTokens.length; i++) {
    const token = pkgTokens[i]!;

    if (token === "--version" && ecosystem === "cargo") {
      if (i + 1 < pkgTokens.length && !pkgTokens[i + 1]?.startsWith("-")) {
        explicitCargoVersion = pkgTokens[i + 1];
        if (items.length > 0) {
          const prev = items[items.length - 1]!;
          items[items.length - 1] = { purl: prev.purl, version: explicitCargoVersion! };
        }
        i++;
        continue;
      }
    }

    if (token.startsWith("--version=") && ecosystem === "cargo") {
      explicitCargoVersion = token.slice("--version=".length);
      if (items.length > 0) {
        const prev = items[items.length - 1]!;
        items[items.length - 1] = { purl: prev.purl, version: explicitCargoVersion! };
      }
      continue;
    }

    // Skip flags
    if (token.startsWith("-")) {
      // If flag takes an argument, skip next token
      if (
        (token === "-r" ||
          token === "--requirement" ||
          token === "--target" ||
          token === "--features" ||
          token === "-F") &&
        i + 1 < pkgTokens.length &&
        !pkgTokens[i + 1]?.startsWith("-")
      ) {
        i++;
      }
      continue;
    }

    // Parse package token according to ecosystem
    if (ecosystem === "npm") {
      if (token.startsWith("@")) {
        const secondAt = token.indexOf("@", 1);
        const namePart = secondAt !== -1 ? token.slice(0, secondAt) : token;
        const ver = secondAt !== -1 ? token.slice(secondAt + 1) : "*";
        const slash = namePart.indexOf("/");
        if (slash !== -1) {
          const scope = namePart.slice(1, slash);
          const name = namePart.slice(slash + 1);
          items.push({ purl: `pkg:npm/%40${scope}/${name}`, version: ver || "*" });
        } else {
          items.push({ purl: `pkg:npm/${namePart}`, version: ver || "*" });
        }
      } else {
        const at = token.indexOf("@");
        if (at !== -1) {
          items.push({
            purl: `pkg:npm/${token.slice(0, at)}`,
            version: token.slice(at + 1) || "*",
          });
        } else {
          items.push({ purl: `pkg:npm/${token}`, version: "*" });
        }
      }
    } else if (ecosystem === "pypi") {
      const match = token.match(/^([a-zA-Z0-9_.-]+)(.*)$/);
      if (match) {
        const name = match[1];
        const rest = match[2]?.trim() ?? "";
        let ver = "*";
        if (rest.startsWith("==")) {
          ver = rest.slice(2).trim();
        } else if (rest.length > 0) {
          ver = rest;
        }
        items.push({ purl: `pkg:pypi/${name}`, version: ver || "*" });
      }
    } else if (ecosystem === "cargo") {
      const at = token.indexOf("@");
      if (at !== -1) {
        items.push({
          purl: `pkg:cargo/${token.slice(0, at)}`,
          version: token.slice(at + 1) || "*",
        });
      } else {
        items.push({ purl: `pkg:cargo/${token}`, version: explicitCargoVersion ?? "*" });
      }
    } else if (ecosystem === "golang") {
      const at = token.indexOf("@");
      if (at !== -1) {
        items.push({
          purl: `pkg:golang/${token.slice(0, at)}`,
          version: token.slice(at + 1) || "*",
        });
      } else {
        items.push({ purl: `pkg:golang/${token}`, version: "*" });
      }
    }
  }

  if (items.length === 0) {
    throw new Error("No packages could be identified in the install command.");
  }

  return { items, ecosystem };
}

export const checkInstallTool: McpTool = {
  definition: {
    name: "check_install",
    description:
      'Call before running an install command. Parses package manager commands (npm, pnpm, yarn, bun, pip, cargo, go) and checks every package against lifecycle rules. Example: {"command":"npm install request@2.88.2"}.',
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "Raw install command string (e.g. 'npm install request@2.88.2', 'pip install flask', 'cargo add tokio').",
        },
        as_of: {
          type: "string",
          description: "Optional reference date in YYYY-MM-DD format for time-travel lifecycle evaluation.",
        },
        asOf: {
          type: "string",
          description: "Alias for as_of.",
        },
      },
      required: ["command"],
    },
    outputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        packages: { type: "array" },
        results: { type: "array" },
        summary: { type: "object" },
        provenance: { type: "object" },
        dataVersion: { type: "string" },
      },
      required: ["command", "results", "summary"],
    },
  },
  handler: (args: Record<string, unknown>): McpToolResult => {
    const cmdArg = typeof args.command === "string" ? args.command : "";
    if (!cmdArg.trim()) {
      return {
        content: [
          {
            type: "text",
            text: "Error: 'command' parameter is required and must not be empty.",
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
      const { items } = parseInstallCommand(cmdArg);
      const rawResult = asOfArg ? asOf(asOfArg).checkAll(items) : checkAll(items);
      const formatted = formatCheckAllResult(rawResult);

      const payload = {
        command: cmdArg,
        packages: items,
        ...formatted,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
        structuredContent: payload as unknown as Record<string, unknown>,
        isError: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `Error parsing or checking install command: ${message}`,
          },
        ],
        isError: true,
      };
    }
  },
};
