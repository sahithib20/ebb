---
title: "Offline Operation & Air-Gapped Guide"
description: "How Ebb operates without network access, air-gapped updates from signed bundles, release mirrors, and offline verification."
layout: doc
permalink: /offline/
---

# Offline Operation & Air-Gapped Guide

Ebb is designed and tested to operate completely offline. Lifecycle rules ship directly within the package distribution, so dependency evaluations, SBOM scanning, version picking, and AI agent queries require zero network access.

## What Works With No Network

<!-- test: tests/offline/no-network.test.ts -->
The entire core API runs without network access:
- `check(purl, version)`: Evaluates deprecation, support status, and end-of-life dates against local lifecycle rules.
- `createEbb({ ecosystems })`: Instantiates isolated, scoped lifecycle evaluators.
- `checkAll(items)`: Batch-evaluates dependencies from lists or CycloneDX SBOM manifests.
- `replacementFor(purl, version)`: Resolves recommended migration targets and replacements.
- `rulesFor(purl)`: Returns all registered lifecycle rules matching a package.
- `supportedVersions(purl)`: Lists active release lines and identifies supported lines.
- `asOf(date)`: Deterministic time-travel lifecycle evaluation.
- `upcoming({ within })` / `recent({ within })`: Queries upcoming and recent end-of-life milestones.
- `toICal(options)`: Generates iCalendar feeds from local lifecycle deadlines.
- `stale()`: Evaluates rule review freshness against local dataset records.
- `sourcesOf(ruleId)`: Inspects cited evidence, archive snapshots, and review provenance.

<!-- test: tests/mcp/no-network.test.ts -->
The Model Context Protocol (MCP) server runs completely offline:
- Every tool (`check`, `check_all`, `check_install`, `diff`, `pick_version`, `replacement_for`, `sources_of`, `upcoming`) reads solely from bundled or cached local data.
- MCP tools never attempt background fetches or network calls on their own.

<!-- test: tests/cli.test.ts ("runs check --offline without attempting network and prints nothing extra") -->
The CLI operates offline:
- Commands that do not download updates (`check`, `check-all`, `as-of`, `versions`, `replacement`, `rules`, `upcoming`, `forecast`, `recent`, `stale`, `sources`, `diff`, `data-status`, `verify`) never touch the network and print nothing extra when `--offline` is specified.

## What Does Not Work With No Network

<!-- test: tests/data-update.test.ts ("update() classifies no-network failure and provides suggested next step with at most 1 retry") -->
The only operation in Ebb that accesses the network is downloading remote updates:
- Remote updates (`ebb update` or `update()` without a local file) require network access to GitHub releases or a configured mirror.
- Static API client (`@velella/ebb/api`) queries a remote static JSON API endpoint and requires network access.

<!-- test: tests/data-update.test.ts ("update() classifies DNS failure and provides suggested next step") -->
<!-- test: tests/data-update.test.ts ("update() classifies proxy error and provides suggested next step") -->
<!-- test: tests/data-update.test.ts ("update() classifies rate limit (HTTP 429) and provides suggested next step") -->
When remote updates cannot connect, Ebb distinguishes network failure causes and provides actionable guidance:
- `no-network`: The network is unreachable or the connection failed; suggests checking connection or using `--from`.
- `dns-failure`: DNS resolution failed; suggests checking DNS or using a local mirror.
- `proxy-error`: Proxy connection or authentication failed; suggests checking proxy credentials and environment variables.
- `rate-limited`: Remote HTTP 429 rate limit exceeded; suggests waiting or configuring an internal mirror.
- In every failure mode, the local cache remains untouched and the update retries at most once.

## Enforcing Offline Mode

### Environment Variable (`EBB_OFFLINE=1`)

<!-- test: tests/data-update.test.ts ("EBB_OFFLINE=1 blocks update() before any network request") -->
Setting `EBB_OFFLINE=1` guarantees that no network request will be attempted:
```bash
export EBB_OFFLINE=1
ebb update
```
If an update is attempted without a local file, Ebb immediately throws `DataUpdateError` with reason code `offline` before making any network calls.

<!-- test: tests/static-api.test.ts ("EBB_OFFLINE=1 blocks static API client requests with offline code") -->
The static API client also honors `EBB_OFFLINE=1` and refuses requests immediately:
```ts
process.env.EBB_OFFLINE = "1";
await fetchMeta(); // Throws EbbError with code "offline"
```

### CLI Flag (`--offline`)

<!-- test: tests/cli.test.ts ("stops update --offline and prints exactly one line on stderr") -->
Pass `--offline` to any CLI command to force offline behavior:
```bash
# Succeeded: check never uses the network
ebb check pkg:npm/express@4.18.2 --offline

# Stopped: prints exactly one line on stderr and exits 1
ebb update --offline
# Stderr: Ebb is running in offline mode; network request stopped.
```

## Air-Gapped Updates from a Local File

In secure or disconnected environments where outbound internet access is prohibited, you can update lifecycle rules using signed release bundles.

### 1. Download Bundle and Signature Outside Air-Gap

<!-- test: tests/data-update.test.ts ("update({ from: bundleFile }) installs local bundle with rollback copy") -->
Download the bundle and its Sigstore signature from the GitHub Releases page:
- `ebb-data-<version>.json`
- `ebb-data-<version>.json.sigstore.json`

Ensure both files remain adjacent in the same directory.

### 2. Transfer and Apply in Air-Gapped Environment

<!-- test: tests/data-update.test.ts ("update({ from: bundleFile }) works even when EBB_OFFLINE=1") -->
Run `ebb update --from <bundle>`:
```bash
ebb update --from /path/to/ebb-data-2026.10.16.json
```
This command works even when `EBB_OFFLINE=1` or `--offline` is set.

<!-- test: tests/data-update.test.ts ("update({ from: bundleFile }) rejects tampered bundle leaving cache untouched") -->
<!-- test: tests/data-update.test.ts ("update({ from: bundleFile }) rejects bundle when signature file is missing") -->
Ebb automatically verifies:
1. The cryptographic Sigstore signature against the official trusted root identity.
2. The `contentDigest` SHA-256 hash across all registry files.
3. The rollback guard to prevent replay attacks.

If verification fails or the signature file is missing, the update is rejected and the existing cache is left untouched.

### 3. Reversibility and Rollback

<!-- test: tests/data-update.test.ts ("rollback() reverts to previous cached version and back to bundled data") -->
Every local file update creates a rollback copy in `previous.json`. If you need to revert:
```bash
ebb update --rollback
```
This safely rolls back to the prior active version or back to the package-bundled data.

## Setting Up an Internal Release Mirror

Organizations with internal package mirrors or artefact repositories can host data releases internally.

<!-- test: tests/data-update.test.ts ("update() reads releases from EBB_RELEASES_URL mirror and rejects re-signed bundle") -->
### 1. Mirror Release Files

Host the following files on an internal HTTPS web server:
- `releases.json`: A JSON list of available releases following the GitHub releases API schema.
- Data bundles and their `.sigstore.json` signature files.

### 2. Configure Ebb to Use the Mirror

Set the `EBB_RELEASES_URL` environment variable:
```bash
export EBB_RELEASES_URL="https://mirror.internal.corp/ebb/releases.json"
ebb update
```
Ebb will fetch the release index and bundle assets from your mirror.

Signature verification continues to enforce the official Sigstore trusted root; bundles that have been tampered with or re-signed by an untrusted key will be rejected.

## Data Freshness & Stale Data Warnings

<!-- test: tests/data-status.test.ts ("dataStatus includes warning when active data is older than stale limit") -->
<!-- test: tests/data-status.test.ts ("CLI prints warning on stderr once when data is old, keeping stdout and exit code unchanged") -->
<!-- test: tests/data-status.test.ts ("CLI silences warning on stderr when --quiet (-q) is passed") -->
To help air-gapped systems track whether their local data is out of date:
- Ebb tracks the age of active data against the freshness window (default: 30 days).
- When data exceeds this threshold, `dataStatus()` marks `stale: true`.
- The CLI prints a single-line warning to `stderr` once per run:
  `Warning: Data is X days old (exceeds 30d freshness threshold). Run 'ebb update' to refresh.`
- The warning never fails or blocks evaluations; `stdout` and exit codes remain unaffected.
- Scripts can silence the warning with `--quiet` or `-q`:
  `ebb check pkg:npm/express@4.18.2 --quiet`

## Continuous Integration Without Network

<!-- test: .github/workflows/ci.yml ("offline test suite") -->
In CI environments, Ebb runs its full test suite inside a dedicated Linux network namespace with no external route out (`unshare --net`). Only the loopback interface (`127.0.0.1`) is available for local tests. Any outbound attempt to reach the internet causes the job to fail immediately.
