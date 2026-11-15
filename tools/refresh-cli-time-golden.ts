import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCli } from "../src/cli.js";

export interface GoldenCommand {
  name: string;
  args: string[];
  outputFile: string;
}

export const GOLDEN_COMMANDS: GoldenCommand[] = [
  {
    name: "upcoming (text)",
    args: ["upcoming", "--as-of", "2026-04-01", "--within", "90d", "--ecosystem", "nodejs", "--no-color"],
    outputFile: "upcoming.txt",
  },
  {
    name: "upcoming (json)",
    args: ["upcoming", "--as-of", "2026-04-01", "--within", "90d", "--ecosystem", "nodejs", "--json"],
    outputFile: "upcoming.json",
  },
  {
    name: "forecast (text)",
    args: ["forecast", "--as-of", "2026-04-01", "--months", "6", "--ecosystem", "nodejs", "--no-color"],
    outputFile: "forecast.txt",
  },
  {
    name: "forecast (json)",
    args: ["forecast", "--as-of", "2026-04-01", "--months", "6", "--ecosystem", "nodejs", "--json"],
    outputFile: "forecast.json",
  },
  {
    name: "recent (text)",
    args: ["recent", "--as-of", "2026-04-01", "--within", "90d", "--no-color"],
    outputFile: "recent.txt",
  },
  {
    name: "recent (json)",
    args: ["recent", "--as-of", "2026-04-01", "--within", "90d", "--json"],
    outputFile: "recent.json",
  },
  {
    name: "as-of (text)",
    args: ["as-of", "2027-05-01", "node", "22.11.0", "--no-color"],
    outputFile: "as-of.txt",
  },
  {
    name: "as-of (json)",
    args: ["as-of", "2027-05-01", "node", "22.11.0", "--json"],
    outputFile: "as-of.json",
  },
];

export async function runCommandCapture(args: string[]): Promise<string> {
  let stdout = "";
  const io = {
    stdout: {
      write(str: string) {
        stdout += str;
        return true;
      },
    },
    stderr: {
      write() {
        return true;
      },
    },
  };
  await runCli(args, io);
  return stdout;
}

export async function refreshGoldenFiles(targetDir?: string): Promise<void> {
  const dir = targetDir ?? resolve(process.cwd(), "tests/fixtures/cli-time");
  mkdirSync(dir, { recursive: true });

  for (const cmd of GOLDEN_COMMANDS) {
    const output = await runCommandCapture(cmd.args);
    const filePath = resolve(dir, cmd.outputFile);
    writeFileSync(filePath, output, "utf8");
    console.log(`Wrote ${cmd.outputFile} (${cmd.name})`);
  }
}

if (
  process.argv[1]?.endsWith("refresh-cli-time-golden.js") ||
  process.argv[1]?.endsWith("refresh-cli-time-golden.ts")
) {
  await refreshGoldenFiles();
}
