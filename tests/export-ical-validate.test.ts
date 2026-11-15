import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toICal } from "../src/export/ical.js";
import type { RegistryV2Rule } from "../src/registry.js";
import { generateStaticApi } from "../tools/static-api/generate.js";

const EVENT_PROPS = ["UID", "DTSTAMP", "DTSTART"] as const;
const CALENDAR_PROPS = ["VERSION", "PRODID"] as const;

/** Unfolds a calendar and rejects a long line or a missing required property. */
export function parseICalendar(text: string): void {
  if (!text.endsWith("\r\n")) throw new Error("calendar must end with CRLF");
  const physical = text.split("\r\n");
  if (physical.at(-1) !== "") throw new Error("calendar must end with CRLF");
  physical.pop();
  if (text.split("\r\n").join("").includes("\n")) throw new Error("bare LF in calendar");

  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const line of physical) {
    if (line.length === 0) throw new Error("empty line");
    const bytes = encoder.encode(line);
    if (bytes.length > 75) throw new Error(`line exceeds 75 octets (${bytes.length})`);
    decoder.decode(bytes);
  }

  const logical: string[] = [];
  for (const line of physical) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      const previous = logical.at(-1);
      if (previous === undefined) throw new Error("continuation without a line");
      logical[logical.length - 1] = previous + line.slice(1);
    } else {
      logical.push(line);
    }
  }

  const stack: string[] = [];
  let calendarProps: Set<string> | undefined;
  let eventProps: Set<string> | undefined;
  let sawCalendar = false;
  let componentCount = 0;

  for (const line of logical) {
    if (line.startsWith("BEGIN:")) {
      const name = line.slice("BEGIN:".length);
      stack.push(name);
      if (name === "VCALENDAR") {
        if (sawCalendar || stack.length !== 1) throw new Error("expected one calendar");
        sawCalendar = true;
        calendarProps = new Set();
      }
      if (name === "VEVENT" || name === "VFREEBUSY") {
        if (stack.length !== 2 || stack[0] !== "VCALENDAR") throw new Error("component outside calendar");
        componentCount++;
        eventProps = new Set();
      } else if (name !== "VCALENDAR") {
        throw new Error(`unexpected component ${name}`);
      }
      continue;
    }
    if (line.startsWith("END:")) {
      const name = line.slice("END:".length);
      const open = stack.pop();
      if (open !== name) throw new Error(`END:${name} does not close ${open ?? "nothing"}`);
      if (name === "VEVENT" || name === "VFREEBUSY") {
        const requiredProps = name === "VEVENT" ? EVENT_PROPS : ["UID", "DTSTAMP"];
        for (const required of requiredProps) {
          if (!eventProps?.has(required)) throw new Error(`missing ${required}`);
        }
        eventProps = undefined;
      }
      if (name === "VCALENDAR") {
        if (componentCount === 0) throw new Error("calendar has no component");
        for (const required of CALENDAR_PROPS) {
          if (!calendarProps?.has(required)) throw new Error(`missing ${required}`);
        }
      }
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 0) throw new Error(`property without a value: ${line.slice(0, 40)}`);
    const key = line.slice(0, colon).split(";")[0];
    if (!key) throw new Error("empty property name");
    if (eventProps) eventProps.add(key);
    else if (stack.at(-1) === "VCALENDAR") calendarProps?.add(key);
    else throw new Error("property outside calendar");
  }

  if (!sawCalendar) throw new Error("missing VCALENDAR");
  if (stack.length > 0) throw new Error(`unclosed ${stack.at(-1)}`);
}

/** Git checks text files out with LF. The parser requires CRLF, so fixtures are restored first. */
async function readFixture(path: string): Promise<string> {
  const text = await readFile(path, "utf8");
  return text.replace(/\r?\n/g, "\r\n");
}

async function icsFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries.filter((entry): entry is string => typeof entry === "string" && entry.endsWith(".ics")).sort();
}

describe("iCalendar validation", () => {
  it("rejects a line over 75 octets and a missing UID", async () => {
    const longLine = await readFixture("tests/fixtures/ical/line-too-long.ics");
    await assert.rejects(async () => parseICalendar(longLine), /75 octets/);
    const missing = await readFixture("tests/fixtures/ical/missing-uid.ics");
    await assert.rejects(async () => parseICalendar(missing), /missing UID/);
  });

  it("accepts an empty result with no deadline events", () => {
    const text = toICal({ rules: [] });
    assert.doesNotMatch(text, /BEGIN:VEVENT/);
    assert.match(text, /BEGIN:VFREEBUSY/);
    parseICalendar(text);
  });

  it("accepts a folded calendar from toICal", () => {
    const sample: RegistryV2Rule = {
      id: "npm.example.eol",
      ecosystem: "npm",
      purl: "pkg:npm/example",
      vers: "vers:npm/*",
      event: "end-of-life",
      title: `Example ${"é".repeat(40)}`,
      summary: `Line\n${"b".repeat(200)}`,
      severity: "high",
      replacement: "pkg:npm/other",
      deadline: "2026-06-01",
      sources: [{ title: "Vendor", url: "https://example.com/eol" }],
      provenance: { observedAt: "2026-01-02", reviewedAt: "2026-01-15", reviewer: "test", method: "manual" },
    };
    parseICalendar(toICal({ rules: [sample], asOf: "2026-01-01", within: "1y" }));
  });

  it("parses every generated feed and every feed linked from the docs", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ebb-ical-"));
    try {
      await generateStaticApi({ outDir: tempDir, createdAt: "2026-11-12T00:00:00.000Z" });
      const feeds = await icsFiles(join(tempDir, "calendar"));
      assert.ok(feeds.includes("all.ics"));
      assert.ok(feeds.includes("npm.ics"));
      assert.ok(feeds.includes("nodejs.ics"));
      assert.ok(feeds.includes(join("generic", "nodejs.ics")));
      assert.equal(
        feeds.some((file) => file.endsWith(join("npm", "request.ics"))),
        false,
      );
      for (const file of feeds) parseICalendar(await readFile(join(tempDir, "calendar", file), "utf8"));

      const docs = await readFile("docs/calendar.md", "utf8");
      const urls = [...docs.matchAll(/https:\/\/velella\.sh\/ebb\/api\/v1\/(calendar\/[^\s)]+\.ics)/g)].map(
        (match) => match[1]!,
      );
      assert.ok(urls.length >= 4);
      for (const url of urls) {
        const body = await readFile(join(tempDir, url), "utf8");
        parseICalendar(body);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
