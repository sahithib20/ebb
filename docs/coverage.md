---
title: "Runtime release-line coverage"
description: "Which language runtimes and official GitHub Actions Ebb tracks end-to-end, what complete means, and the sources each list uses."
layout: doc
permalink: /coverage/
---

Ebb aims to know every release line for the runtimes below: ended lines and scheduled end dates, taken only from each project's own support schedule.

## What "complete" means

A runtime is **complete** when both are true:

1. **Every release line first released since 2018** has a registry rule that covers its end (end-of-life, end-of-support, or an equivalent catch-all that matches that line).
2. **Every still-supported line with an official end date** has a `scheduled-end-of-life` (or scheduled end-of-support) rule for that date.

Dates keep the precision the official source publishes. Month-only announcements stay month-precision in summaries, in `x-*.endOfLifeMonth` on the rule, and as `datePrecision: "month"` on `check()` / `upcoming()` results (with `date` / `deadline` kept as the last day of that month for day arithmetic). The checker compares scheduled milestones to the official date at that precision and requires one scheduled rule to cover the release line’s full `lineVers` range and match that deadline. Ebb does not invent a day-of-month from a month-only source, and it does not copy dates from third-party aggregators.

Runtimes with **no published support schedule** are listed only to document that limit. They are not treated as incomplete for lacking dated rules.

## Scope

| Runtime | Official schedule | In scope |
| --- | --- | --- |
| Node.js | [Node.js Release Working Group schedule](https://github.com/nodejs/Release/blob/main/schedule.json) | Yes |
| Python | [Status of Python versions](https://devguide.python.org/versions/) ([machine-readable cycle](https://peps.python.org/api/release-cycle.json)) | Yes |
| Go | [Go release history and support policy](https://go.dev/doc/devel/release) | Yes |
| Java | [Eclipse Temurin support](https://adoptium.net/support/) (OpenJDK / Temurin availability; vendor named per rule) | Yes |
| Ruby | [Ruby maintenance branches](https://www.ruby-lang.org/en/downloads/branches/) | Yes |
| PHP | [PHP supported versions](https://www.php.net/supported-versions.php) ([unsupported branches](https://www.php.net/eol.php)) | Yes |
| .NET | [.NET and .NET Core support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core) | Yes |
| Rust | [Rust Book — maintenance time](https://doc.rust-lang.org/book/appendix-07-nightly-rust.html#maintenance-time) ([security policy](https://www.rust-lang.org/policies/security)) | Yes |
| Deno | [Deno stability and releases (LTS)](https://docs.deno.com/runtime/fundamentals/stability_and_releases/) | Yes (dated LTS lines only) |
| Bun | No official dated support schedule | Limits only — no dated rules required |

## Coverage status

The table below is filled at documentation build time by `tools/coverage/runtimes.ts` from the reviewed expected release lines under `tools/coverage/expected/` and the current registry. It is not edited by hand.

<!-- runtime-coverage:begin -->

| Runtime | Status | Missing lines | Missing scheduled |
| --- | --- | --- | --- |
| bun | limit | — | — |
| deno | complete | — | — |
| dotnet | complete | — | — |
| go | complete | — | — |
| java | complete | — | — |
| nodejs | complete | — | — |
| php | complete | — | — |
| python | complete | — | — |
| ruby | complete | — | — |
| rust | complete | — | — |

<!-- runtime-coverage:end -->

## Limits

- **Bun:** No official dated support or LTS schedule is published. Existing historical Bun entries in `registry/deno.json` are not expanded; new dated Bun rules are not added until Bun publishes a schedule.
- **Deno:** Coverage tracks the official LTS maintenance table on the Deno stability page. Undated stable-channel minors without an LTS row are not given invented end dates.
- **Ruby 3.4 / 4.0 / 4.1:** The maintenance branches page lists EOL as TBD; those lines stay policy-only until a date is published.
- **Java LTS (Temurin):** Java 11, 17, 21, and 25 are recorded as supported without a fixed EOL. Temurin’s “At least …” availability floors are not treated as end dates, so no scheduled rule is invented from them.

## Checker

```bash
npm run build --silent
node dist/tools/coverage/runtimes.js
```

The checker reads only local expected JSON and `registry/`. It does not fetch the network. Exit code `0` means complete, `1` means at least one in-scope runtime still has a gap (the docs table is still written with `--write-docs`), and `2` means a checker or write error.

## Official Actions

Ebb records which major versions of official GitHub Actions run on a Node.js runtime GitHub has removed from Actions runners.

An action is **complete** when every published major whose `action.yml` sets `runs.using` to `node12`, `node16`, or `node20` is matched by a registry end rule (`end-of-support`, `end-of-life`, or `removed`) for that action. The rule's VERS range must contain version `N.0.0`. A catch-all such as `vers:semver/<5.0.0` covers major 4. When the inventory lists `releases` because `runs.using` changes inside a major, the checker also requires an end rule for each retired release version, such as `6.0.0` and `6.1.0` under `actions/setup-go` while `6.2.0` stays on Node.js 24.

Node.js 20 was removed from GitHub-hosted Actions runners on 2026-09-23 ([changelog](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/)). Node.js 12 was removed on 2023-08-14 and Node.js 16 on 2024-11-12. This list was reviewed on 2026-11-15, after all three dates, so those majors are `end-of-support` or `removed`. They are not `scheduled-end-of-life`.

A **coverage limit** explains why an action has no Node.js rule: it is composite, Docker, a starter template, or it has no retired JavaScript major. The limit does not hide a retired runtime the inventory lists, and an in-scope action missing from the inventory is incomplete. Majors that set `runs.using` to `node24`, `composite`, or `docker` do not need a retired-runtime rule.

Third-party actions already in the registry (`docker/*`, `softprops/action-gh-release`, `hashicorp/setup-terraform`, `astral-sh/setup-uv`) stay there. They are not part of this completeness list.

Rules keep a string `replacement`, and cases keep matching that string. Structured replacement objects wait on [#418](https://github.com/velella-sh/ebb/issues/418). This page does not close #544 or #381.

### Scope

Reviewed on 2026-11-15 from the non-archived repositories in the [`actions` organization](https://github.com/orgs/actions/repositories) that have a root `action.yml` or `action.yaml` (39 repositories), plus the JavaScript subpaths of [`github/codeql-action`](https://github.com/github/codeql-action): `init`, `autobuild`, `analyze`, and `upload-sarif`. The root CodeQL action is composite and is not a separate scope entry. Callers pin the subpath, and the PURL identity drops it, so the rules use `pkg:github/github/codeql-action`. The majors, release boundaries, and `runs.using` values are the reviewed inventory at `tools/coverage/expected/github-actions-inventory.json`. The scope list is `tools/coverage/expected/github-actions.json`. A maintainer tool, `tools/coverage/refresh-actions-inventory.ts`, refreshes that inventory from GitHub. It does not write rules. The weekly importers workflow opens an inventory-only pull request when the snapshot changes.

### Coverage status

The table below is filled by `tools/coverage/actions.ts`. It is not edited by hand.

<!-- actions-coverage:begin -->

| Action | Status | Missing majors |
| --- | --- | --- |
| actions/add-to-project | complete | — |
| actions/ai-inference | complete | — |
| actions/attest | complete | — |
| actions/attest-build-provenance | limit | — |
| actions/attest-sbom | limit | — |
| actions/cache | complete | — |
| actions/checkout | complete | — |
| actions/component-detection-dependency-submission-action | limit | — |
| actions/configure-pages | complete | — |
| actions/container-action | limit | — |
| actions/container-prebuilt-action | limit | — |
| actions/container-toolkit-action | limit | — |
| actions/create-github-app-token | complete | — |
| actions/delete-package-versions | complete | — |
| actions/dependency-review-action | complete | — |
| actions/deploy-pages | complete | — |
| actions/download-artifact | complete | — |
| actions/first-interaction | complete | — |
| actions/github-script | complete | — |
| actions/go-dependency-submission | complete | — |
| actions/gradle-build-tools-actions | limit | — |
| actions/hello-world-docker-action | limit | — |
| actions/hello-world-javascript-action | limit | — |
| actions/javascript-action | limit | — |
| actions/jekyll-build-pages | limit | — |
| actions/labeler | complete | — |
| actions/maven-dependency-submission-action | limit | — |
| actions/publish-action | limit | — |
| actions/publish-immutable-action | limit | — |
| actions/setup-dotnet | complete | — |
| actions/setup-go | complete | — |
| actions/setup-java | complete | — |
| actions/setup-node | complete | — |
| actions/setup-python | complete | — |
| actions/stale | complete | — |
| actions/typescript-action | limit | — |
| actions/upload-artifact | complete | — |
| actions/upload-code-coverage | limit | — |
| actions/upload-pages-artifact | limit | — |
| github/codeql-action/init | complete | — |
| github/codeql-action/autobuild | complete | — |
| github/codeql-action/analyze | complete | — |
| github/codeql-action/upload-sarif | complete | — |

<!-- actions-coverage:end -->

### Limits

- **Templates:** `typescript-action`, `javascript-action`, `container-action`, `container-toolkit-action`, `container-prebuilt-action`, `hello-world-javascript-action`, and `hello-world-docker-action` are starter repositories. Workflows do not pin a released major of them.
- **Composite, no Node runtime:** `upload-pages-artifact`, `attest-build-provenance`, `attest-sbom`, and `upload-code-coverage`. `gradle-build-tools-actions` has no version tags. Its root `action.yml` is a composite stub that tells callers to use `gradle/actions/setup-gradle` or `gradle/actions/dependency-submission`.
- **CodeQL subpaths:** `init`, `autobuild`, `analyze`, and `upload-sarif` use node12 on v1, node16 on v2, node20 on v3, and node24 on v4. One set of end rules on `pkg:github/github/codeql-action` covers all four.
- **Pages on GitHub.com:** From 2025-01-30, custom Pages workflows must use `actions/upload-pages-artifact@v3` and `actions/deploy-pages@v4` ([changelog](https://github.blog/changelog/2024-12-05-deprecation-notice-github-pages-actions-to-require-artifacts-actions-v4-on-github-com/)). That requirement does not affect GitHub Enterprise Server. `configure-pages` and `deploy-pages` keep their Node.js runtime rules.
- **Docker:** `jekyll-build-pages` sets `runs.using` to `docker`.
- **No major tags:** `publish-action` (v0.1.0–v0.4.0) and `publish-immutable-action` (v0–v0.0.4) publish only 0.x tags. `maven-dependency-submission-action` and `component-detection-dependency-submission-action` had no git tags on 2026-11-15.
- **delete-package-versions:** v1–v2 use node12, v3–v4 use node16, and v5 uses node20. The default branch still uses node20, so the replacement does not name a major.
- **go-dependency-submission:** v1 uses node16 and v2 uses node20. The default branch uses node24 and has no major tag, so the replacement does not name v2.
- **Artifact and cache:** `github-actions.upload-artifact.retired` and `github-actions.download-artifact.retired` cover versions below 4.0.0, removed on 2025-01-30 (v1 and v2 on 2024-06-30), with brownouts on 2025-01-09, 2025-01-16, and 2025-01-23. That service removal does not affect GitHub Enterprise Server ([v3 artifact deprecation](https://github.blog/changelog/2024-04-16-deprecation-notice-v3-of-the-artifact-actions/)). Later node20 majors are separate end-of-support rules: upload `>=4.0.0|<6.0.0` and download `>=4.0.0|<7.0.0`, so upload 6.0.0 is clean. `github-actions.cache.service-v1-v2` covers cache below 3.0.0, retired on 2025-03-01, with brownouts on 2025-02-04, 2025-02-11, and 2025-02-18, and does not affect GitHub Enterprise Server. `github-actions.cache.node20` is the runtime band `>=3.0.0|<5.0.0` only.

### Checker

```bash
npm run build --silent
node dist/tools/coverage/actions.js
```

The checker reads only the scope file, the inventory, and `registry/github-actions.json`. It does not fetch the network. Exit code `0` means complete, `1` means at least one in-scope action still has a gap (the docs table is still written with `--write-docs`), and `2` means a checker or write error. The weekly importers workflow refreshes the inventory snapshot (network, in that workflow only) and opens an inventory-only pull request when it changed. It then runs this checker on that snapshot, opens one issue per action that has a gap, and publishes the table. It does not edit `registry/`.
