# Agent Session Transcripts

This directory contains the unedited execution transcripts from the side-by-side agent demo documented in [`docs/demo/agent.md`](../agent.md).

## Files

- [`without-ebb.jsonl`](without-ebb.jsonl): Unassisted agent interaction log where the model selects `request@2.88.2`.
- [`with-ebb.jsonl`](with-ebb.jsonl): Ebb MCP-assisted interaction log where the model intercepts the deprecated package and selects `undici`.

## Methodology

Both sessions were conducted using standard JSON-RPC agent tool harnesses with identical system prompts, differing solely in the availability of Ebb's MCP lifecycle tools (`check`, `replacement_for`, `pick_version`).
