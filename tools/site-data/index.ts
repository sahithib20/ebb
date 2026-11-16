#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { generateSiteData } from "./generate.js";
import { validateSiteDataDir } from "./validate.js";

function getArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

export async function main(argv: string[]): Promise<void> {
  const root = resolve(getArg(argv, "--root") ?? process.cwd());
  const outDir = resolve(getArg(argv, "--out") ?? "dist/site-data");
  const baseUrl = getArg(argv, "--base-url");
  const dataVersion = getArg(argv, "--data-version");
  const updateLock = argv.includes("--update-lock");
  const shouldValidate = argv.includes("--validate");

  const result = await generateSiteData({
    root,
    outDir,
    baseUrl,
    dataVersion,
    updateLock,
  });

  process.stderr.write(
    `Ebb Site Data generated at ${result.outDir}:\n` +
      `  Data Version: ${result.dataVersion}\n` +
      `  Components:   ${result.componentCount}\n` +
      `  Rules:        ${result.ruleCount}\n` +
      `  Lines:        ${result.lineCount}\n` +
      `  Ecosystems:   ${result.ecosystemCount}\n` +
      `  Files:        ${result.files.length}\n` +
      `  Total size:   ${result.totalBytes} bytes (${(result.totalGzipBytes / 1024).toFixed(1)} KB gzipped)\n`,
  );

  if (shouldValidate) {
    const valResult = await validateSiteDataDir(outDir, { root });
    process.stderr.write(`✅ Site data validated against schema (${valResult.checkedFiles} files checked).\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  });
}
