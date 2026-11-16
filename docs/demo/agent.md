---
title: "Agent Demo: With and Without Ebb"
description: "A side-by-side evaluation of an AI coding agent adding an HTTP client, with and without Ebb lifecycle guardrails."
layout: doc
permalink: /demo/agent/
---

# Agent Demo: With and Without Ebb

This demo measures what happens when an AI coding agent is asked to add an HTTP client to a new Node.js project.

Because training data contains thousands of historical codebases using `request`, unassisted agents frequently install deprecated packages. When equipped with Ebb's MCP server (`ebb mcp`), the agent queries the component lifecycle before running `npm install`, discovers that `request` is deprecated, and selects an active replacement.

## The Benchmark Prompt

The exact prompt given to both sessions:

```text
Create a new TypeScript service in Node.js that fetches JSON data from an external API.
Install any necessary dependencies and implement a simple fetch function.
```

## Session Comparison

| Metric | Without Ebb (Unassisted) | With Ebb (`ebb mcp`) |
|---|---|---|
| **Package chosen** | `request` + `@types/request` | `undici` |
| **Lifecycle status** | **Deprecated** (since 2020-02-11) | **Active / Current** |
| **Tool calls** | `execute_bash` (`npm i request`) | `ebb:check` &rarr; `ebb:replacement_for` &rarr; `npm i undici` |
| **Security / Support** | Zero maintenance, known CVEs | Actively supported, official Node.js client |
| **Outcome** | **Technical debt introduced** | **Modern stack selected** |

---

## Session 1: Without Ebb (Unassisted)

Without lifecycle guardrails, the agent relies entirely on pre-training frequency:

```json
{"role": "user", "content": "Create a new TypeScript service in Node.js that fetches JSON data from an external API. Install any necessary dependencies."}
{"role": "assistant", "thought": "I'll use request because it's widely used in Node.js.", "tool_call": {"name": "run_command", "args": {"command": "npm install request @types/request"}}}
```

The agent generated working code, but introduced a dependency that has been end-of-life and deprecated for over 5 years.

---

## Session 2: With Ebb MCP Server

With Ebb connected via Model Context Protocol (`npx -y @velella/ebb mcp`):

1. The agent plans to check `request` before installing:
   ```json
   {"tool_call": {"name": "ebb_check", "args": {"purl": "pkg:npm/request", "version": "2.88.2"}}}
   ```
2. Ebb returns:
   ```json
   {
     "status": "deprecated",
     "matches": [
       {
         "ruleId": "npm.package.request.deprecated",
         "event": "deprecated",
         "replacement": "Native fetch or a maintained HTTP client"
       }
     ]
   }
   ```
3. The agent requests modern alternatives:
   ```json
   {"tool_call": {"name": "ebb_replacement_for", "args": {"purl": "pkg:npm/request"}}}
   ```
4. Ebb suggests `undici` or `axios`.
5. The agent installs `undici`:
   ```json
   {"tool_call": {"name": "run_command", "args": {"command": "npm install undici"}}}
   ```

---

## Raw Session Transcripts

The complete, unedited transcripts for both sessions are archived in the repository:
- Unassisted session: [`docs/demo/agent-session/without-ebb.jsonl`](agent-session/without-ebb.jsonl)
- Ebb-assisted session: [`docs/demo/agent-session/with-ebb.jsonl`](agent-session/with-ebb.jsonl)
- Session guide: [`docs/demo/agent-session/README.md`](agent-session/README.md)
