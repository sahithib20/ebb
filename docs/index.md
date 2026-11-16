---
title: Ebb documentation
description: Ebb is an open dataset of software lifecycle rules, with a small TypeScript library for reading it.
layout: home
hero:
  eyebrow: Open software lifecycle data
  title: Nothing ships forever. Everything ebbs.
  lead: The open almanac of software end-of-life: what is deprecated, unsupported, or removed, and what to move to.
actions:
  - label: Quickstart (5 min)
    url: quickstart/
    primary: true
  - label: Try the CLI
    url: cli/
  - label: Trust & Verification
    url: trust/
sections:
  - title: Three Ways In
    url: quickstart/
    description: Consume Ebb as a zero-dependency TypeScript library, an offline CLI tool, or an AI agent guardrail.
    icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
    links:
      - title: 1. Library (TypeScript / JS)
        url: quickstart/
        meta: library
      - title: 2. Command Line (CLI)
        url: cli/
        meta: cli
      - title: 3. AI Agents (MCP & Skills)
        url: mcp/
        meta: agent
      - title: Agent Skills
        url: skills/
        meta: agent
  - title: Static API & Calendar
    url: static-api/
    description: Query lifecycle data over zero-maintenance static endpoints or subscribe to release deadlines in your calendar.
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
    links:
      - title: Static JSON API
        url: static-api/
        meta: api
      - title: Lifecycle Calendar
        url: calendar/
        meta: calendar
      - title: Upcoming Deadlines
        url: upcoming/
        meta: reference
      - title: Data Freshness
        url: freshness/
        meta: guide
  - title: Multi-Runtime Support
    url: browser/
    description: Run anywhere with zero dependencies — browsers, edge workers, Deno, Bun, and Node.
    icon: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"
    links:
      - title: Browser
        url: browser/
        meta: runtime
      - title: Edge & Workers
        url: edge/
        meta: runtime
      - title: Deno & JSR
        url: deno/
        meta: runtime
      - title: Bun
        url: bun/
        meta: runtime
  - title: Trust & Standards
    url: trust/
    description: Authoritative evidence, cryptographic signing, open PURL/VERS standards, and honest comparisons.
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
    links:
      - title: Trust & Verification
        url: trust/
        meta: trust
      - title: Comparing Sources
        url: compare/
        meta: compare
      - title: Writing a rule
        url: rules/
        meta: guide
      - title: Data bundles and trust
        url: data/
        meta: guide
  - title: Reference & Architecture
    url: result-model/
    description: Structured schemas, batch inspection, native VERS comparison, and TypeScript definitions.
    icon: "M4 5h7a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H4zM20 5h-6a3 3 0 0 0-3 3v11a2 2 0 0 1 2-2h7z"
    links:
      - title: Result model
        url: result-model/
        meta: reference
      - title: Rules and replacements
        url: rules-for/
        meta: reference
      - title: Batch checking
        url: check-all/
        meta: reference
      - title: VERS version ranges
        url: vers/
        meta: reference
      - title: Decision Records
        url: decisions/0004-registry-v2/
        meta: decision
---

<p align="center">
  <img src="demo/terminal.svg" alt="Ebb terminal demo showing check, replacement, upcoming, and versions commands" width="860">
</p>
