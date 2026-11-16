import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { generateStaticApi } from "./static-api/generate.js";

interface PackFile {
  path: string;
  size: number;
  mode: number;
}

interface PackResult {
  id: string;
  name: string;
  version: string;
  size: number;
  unpackedSize: number;
  shasum: string;
  integrity: string;
  filename: string;
  files: PackFile[];
  entryCount: number;
}

export const STATIC_API_BUDGETS = {
  indexGzip: 50 * 1024, // 50 KB
  searchGzip: 25 * 1024, // 25 KB
  allGzip: 250 * 1024, // 250 KB
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = (bytes / 1024).toFixed(1);
  return `${kb} KB (${bytes.toLocaleString()} bytes)`;
}

export async function measureSize(options?: { apiDir?: string }): Promise<{
  packedSize: number;
  unpackedSize: number;
  budget: number;
  topFiles: PackFile[];
  dataGzipSize: number;
  staticApi: {
    indexGzip: number;
    searchGzip: number;
    allGzip: number;
  };
}> {
  const pkgJson = JSON.parse(readFileSync("package.json", "utf-8"));
  const budget = pkgJson.ebb?.sizeBudget ?? 550000;
  const apiBudgets = {
    indexGzip: pkgJson.ebb?.staticApiBudgets?.indexGzip ?? STATIC_API_BUDGETS.indexGzip,
    searchGzip: pkgJson.ebb?.staticApiBudgets?.searchGzip ?? STATIC_API_BUDGETS.searchGzip,
    allGzip: pkgJson.ebb?.staticApiBudgets?.allGzip ?? STATIC_API_BUDGETS.allGzip,
  };

  const stdout = execSync("npm pack --dry-run --json", { encoding: "utf-8" });
  const parsed: PackResult[] = JSON.parse(stdout);
  const pack = parsed[0];
  if (!pack) {
    throw new Error("No pack result returned by npm pack");
  }

  // Top 10 largest files
  const topFiles = [...pack.files].sort((a, b) => b.size - a.size).slice(0, 10);

  // Measure gzip size of data files in registry
  let totalDataRaw = Buffer.alloc(0);
  for (const f of pack.files) {
    if (f.path.startsWith("registry/") && f.path.endsWith(".json")) {
      try {
        const content = readFileSync(f.path);
        totalDataRaw = Buffer.concat([totalDataRaw, content]);
      } catch {
        // File may be generated
      }
    }
  }
  const dataGzipSize = totalDataRaw.length > 0 ? gzipSync(totalDataRaw).length : 0;

  console.log(`Package: ${pack.name}@${pack.version}`);
  console.log(`Packed size:   ${formatBytes(pack.size)}`);
  console.log(`Unpacked size: ${formatBytes(pack.unpackedSize)}`);
  console.log(`Size budget:   ${formatBytes(budget)}`);
  if (dataGzipSize > 0) {
    console.log(`Registry data (gzipped): ${formatBytes(dataGzipSize)}`);
  }

  console.log("\nTop 10 largest packed files:");
  for (const f of topFiles) {
    console.log(`  ${f.path.padEnd(40)} ${formatBytes(f.size)}`);
  }

  // Measure Static API index files: index.json, search-index.json, all.json
  let apiDir = options?.apiDir ?? resolve("dist/site/api/v1");
  let tempCreated = false;
  if (!existsSync(join(apiDir, "index.json"))) {
    apiDir = mkdtempSync(join(tmpdir(), "ebb-size-static-api-"));
    tempCreated = true;
    await generateStaticApi({ outDir: apiDir });
  }

  let indexGzip = 0;
  let searchGzip = 0;
  let allGzip = 0;

  try {
    const indexBuf = readFileSync(join(apiDir, "index.json"));
    indexGzip = gzipSync(indexBuf).length;

    const searchBuf = readFileSync(join(apiDir, "search-index.json"));
    searchGzip = gzipSync(searchBuf).length;

    const allBuf = readFileSync(join(apiDir, "all.json"));
    allGzip = gzipSync(allBuf).length;
  } finally {
    if (tempCreated) {
      rmSync(apiDir, { recursive: true, force: true });
    }
  }

  console.log("\nStatic API index files (gzipped):");
  console.log(`  index.json:        ${formatBytes(indexGzip)} (budget: ${formatBytes(apiBudgets.indexGzip)})`);
  console.log(`  search-index.json: ${formatBytes(searchGzip)} (budget: ${formatBytes(apiBudgets.searchGzip)})`);
  console.log(`  all.json:          ${formatBytes(allGzip)} (budget: ${formatBytes(apiBudgets.allGzip)})`);

  let failed = false;
  if (pack.size > budget) {
    console.error(`\n❌ Error: Packed size (${pack.size} bytes) exceeds budget of ${budget} bytes!`);
    failed = true;
  }
  if (indexGzip > apiBudgets.indexGzip) {
    console.error(
      `\n❌ Error: index.json gzip size (${indexGzip} bytes) exceeds budget of ${apiBudgets.indexGzip} bytes!`,
    );
    failed = true;
  }
  if (searchGzip > apiBudgets.searchGzip) {
    console.error(
      `\n❌ Error: search-index.json gzip size (${searchGzip} bytes) exceeds budget of ${apiBudgets.searchGzip} bytes!`,
    );
    failed = true;
  }
  if (allGzip > apiBudgets.allGzip) {
    console.error(`\n❌ Error: all.json gzip size (${allGzip} bytes) exceeds budget of ${apiBudgets.allGzip} bytes!`);
    failed = true;
  }

  if (failed) {
    process.exit(1);
  }

  console.log("\n✅ Size checks passed (all within budget).");
  return {
    packedSize: pack.size,
    unpackedSize: pack.unpackedSize,
    budget,
    topFiles,
    dataGzipSize,
    staticApi: {
      indexGzip,
      searchGzip,
      allGzip,
    },
  };
}

if (process.argv[1]?.endsWith("size.ts") || process.argv[1]?.endsWith("size.js")) {
  measureSize().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
