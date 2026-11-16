import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DataInfo } from "./domain.js";
import { defaultCacheDirectory, getActiveDataSync } from "./data-source.js";
import type { ActiveData } from "./data-source.js";

export const DATA_STATUS_SCHEMA_VERSION = "ebb.data-status.v1" as const;

/** Evidence older than this is called stale in every output. */
export const STALE_AFTER_DAYS = 30;

export interface DataStatusOptions {
  /** Reference date to calculate age against. Defaults to system clock (new Date()). */
  now?: Date | string | undefined;
  /** Injected clock function returning a Date object. */
  clock?: (() => Date) | undefined;
  /** Custom stale threshold in days. Defaults to EBB_DATA_MAX_AGE_DAYS env var or 30 days. */
  maxAgeDays?: number | undefined;
  /** Custom cache directory to inspect. */
  cacheDirectory?: string | undefined;
}

export interface DataStatus {
  schemaVersion: typeof DATA_STATUS_SCHEMA_VERSION;
  source: "bundled" | "cache" | "pinned";
  /** The bundle version, or the Ebb release for bundled data. */
  version: string;
  /** When a downloaded bundle was built; null for the bundled data. */
  createdAt: string | null;
  contentDigest: string | null;
  /** The most recent review date among the rules in use. */
  reviewedThrough: string;
  /** Days since `createdAt` for downloaded data, or since `reviewedThrough` for bundled data. */
  ageDays: number;
  ageBasis: "createdAt" | "reviewedThrough";
  staleAfterDays: number;
  stale: boolean;
  signer: { identity: string; issuer: string } | null;
  cacheDirectory: string;
  warnings: string[];
  /** Where the active data originated: package or cache. */
  origin?: "package" | "cache" | undefined;
  /** The filesystem path to the cache directory. */
  cachePath?: string | undefined;
  /** Whether a rollback copy exists in the cache directory. */
  hasRollback?: boolean | undefined;
  /** The version of the rollback copy if one exists. */
  rollbackVersion?: string | null | undefined;
}

const DAY = 24 * 60 * 60 * 1000;

function resolveConfiguredThreshold(custom?: number): number {
  if (typeof custom === "number" && !Number.isNaN(custom) && custom >= 0) {
    return Math.floor(custom);
  }
  const envVal = process.env.EBB_DATA_MAX_AGE_DAYS;
  if (envVal) {
    const parsed = Number.parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return STALE_AFTER_DAYS;
}

/** The compact description of the data in use that is attached to scan and check results. */
export function dataInfoFrom(data: ActiveData, now: Date = new Date(), maxAgeDays?: number): DataInfo {
  const { source, version, createdAt, reviewedThrough, ageDays, stale } = dataStatusFrom(
    data,
    now,
    undefined,
    maxAgeDays,
  );
  return { source, version, createdAt, reviewedThrough, ageDays, stale };
}

export function dataStatusFrom(
  data: ActiveData,
  now: Date = new Date(),
  cacheDirectory: string = defaultCacheDirectory(),
  maxAgeDays?: number,
): DataStatus {
  const { info } = data;
  const ageBasis = info.createdAt ? "createdAt" : "reviewedThrough";
  const since = Date.parse(info.createdAt ?? `${info.reviewedThrough}T00:00:00Z`);
  const ageDays = Number.isNaN(since) ? 0 : Math.max(0, Math.floor((now.getTime() - since) / DAY));
  const staleAfterDays = resolveConfiguredThreshold(maxAgeDays);
  const stale = ageDays > staleAfterDays;

  const warnings = [...info.warnings];
  if (stale) {
    warnings.push(
      `Data is ${ageDays} days old (exceeds ${staleAfterDays}d freshness threshold). Run 'ebb update' to refresh.`,
    );
  }

  // Determine origin: "package" for bundled data, "cache" for cached/downloaded data
  const origin: "package" | "cache" = info.source === "bundled" ? "package" : "cache";

  // Check for rollback copy
  let hasRollback = false;
  let rollbackVersion: string | null = null;
  try {
    const previousPath = join(cacheDirectory, "data", "previous.json");
    if (existsSync(previousPath)) {
      const raw = readFileSync(previousPath, "utf8");
      const parsed = JSON.parse(raw) as { version?: string };
      if (typeof parsed.version === "string" && parsed.version.length > 0) {
        hasRollback = true;
        rollbackVersion = parsed.version;
      }
    } else {
      // Check if earlier versions exist in data/
      const dataDir = join(cacheDirectory, "data");
      if (existsSync(dataDir)) {
        const entries = readdirSync(dataDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && /^\d{4}\.\d{2}\.\d{2}/.test(entry.name))
          .map((entry) => entry.name)
          .filter((v) => (info.source === "cache" ? v !== info.version : true));
        if (entries.length > 0) {
          hasRollback = true;
          entries.sort();
          rollbackVersion = entries[entries.length - 1] ?? null;
        }
      }
    }
  } catch {
    // If directory unreadable or error, rollback not available
  }

  return {
    schemaVersion: DATA_STATUS_SCHEMA_VERSION,
    source: info.source,
    version: info.version,
    createdAt: info.createdAt,
    contentDigest: info.contentDigest,
    reviewedThrough: info.reviewedThrough,
    ageDays,
    ageBasis,
    staleAfterDays,
    stale,
    signer: info.signer,
    cacheDirectory,
    origin,
    cachePath: cacheDirectory,
    hasRollback,
    rollbackVersion,
    warnings,
  };
}

/**
 * Which lifecycle data is active, and how old it is. Reads local files only.
 */
export function dataStatus(options?: DataStatusOptions | Date): DataStatus {
  const opts = options instanceof Date ? { now: options } : (options ?? {});
  const now = opts.clock ? opts.clock() : typeof opts.now === "string" ? new Date(opts.now) : (opts.now ?? new Date());
  const cacheDir = opts.cacheDirectory ?? defaultCacheDirectory();
  return dataStatusFrom(getActiveDataSync(), now, cacheDir, opts.maxAgeDays);
}

/**
 * Which lifecycle data is active, and how old it is. Reads local files only.
 * @deprecated Import from `@velella/ebb` instead; subpath imports will be removed in 1.0.
 */
export async function getDataStatus(now: Date = new Date()): Promise<DataStatus> {
  return dataStatus({ now });
}
