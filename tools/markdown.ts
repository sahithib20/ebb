/** Markdown rendering and link verification helpers. */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Escape text for one Markdown table cell.
 */
export function escapeTableCell(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n|[\r\n]/g, " ");
}

export interface MarkdownLink {
  file: string;
  line: number;
  text: string;
  url: string;
  isInternal: boolean;
}

export interface BrokenLinkReport {
  file: string;
  line: number;
  url: string;
  reason: string;
}

/** Converts a Markdown heading into a URL anchor slug. */
export function slugifyHeading(headingText: string): string {
  return headingText
    .toLowerCase()
    .replace(/[`~!@#$%^&*()_|+\=?;:'",.<>\{\}\[\]\\\/]/gi, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Extracts headings from markdown content and returns a set of available anchor slugs. */
export function extractHeadings(content: string): Set<string> {
  const anchors = new Set<string>();
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      const headingMatch = trimmed.match(/^#+\s+(.*)$/);
      if (headingMatch && headingMatch[1]) {
        const raw = headingMatch[1].trim();
        anchors.add(slugifyHeading(raw));
        // GitHub markdown heading slugifier: strips non-word chars and turns every space into a hyphen
        anchors.add(
          raw
            .toLowerCase()
            .replace(/[^\w\s-]/g, "")
            .trim()
            .replace(/\s/g, "-"),
        );
        // Also add variant where slashes/symbols were replaced with spaces beforehand
        anchors.add(
          raw
            .toLowerCase()
            .replace(/[\/&]/g, " ")
            .replace(/[^\w\s-]/g, "")
            .trim()
            .replace(/\s+/g, "-"),
        );
        anchors.add(
          raw
            .toLowerCase()
            .replace(/[\/&]/g, "-")
            .replace(/[^\w\s-]/g, "")
            .trim()
            .replace(/\s+/g, "-"),
        );
      }
    }
  }
  return anchors;
}

/** Map of Mizzen/Lateen permalinks in docs to file paths. */
export function buildPermalinkMap(docsDir: string): Map<string, string> {
  const permalinks = new Map<string, string>();

  function walk(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const content = readFileSync(full, "utf8");
        const permalinkMatch = content.match(/permalink:\s*([^\s]+)/);
        if (permalinkMatch && permalinkMatch[1]) {
          const raw = permalinkMatch[1].trim();
          permalinks.set(raw, full);
          permalinks.set(raw.replace(/\/$/, ""), full);
          if (!raw.endsWith("/")) permalinks.set(`${raw}/`, full);
        }
        const rel = `/${join(dirname(full).replace(docsDir, ""), entry.name.replace(/\.md$/, "")).replace(/^\/+/, "")}`;
        permalinks.set(rel, full);
        permalinks.set(`${rel}/`, full);
      }
    }
  }

  walk(docsDir);
  return permalinks;
}

/**
 * Determines whether a URL is an internal repository/site link or an external URI.
 * Returns 'internal' for relative/anchor paths, 'http' for http(s) links, and 'other' for external URI schemes.
 */
export function categorizeUrl(url: string): "internal" | "http" | "other" {
  if (!url) return "other";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return "http";
  }
  // Check for any URI scheme (e.g. mailto:, data:, javascript:, tel:)
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return "other";
  }
  return "internal";
}

/** Extracts all markdown links [text](url) with line numbers from markdown text. */
export function extractMarkdownLinks(content: string, filePath: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const lines = content.split("\n");

  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Match [text](url) and <img src="url">
    const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(line)) !== null) {
      const text = match[1] ?? "";
      let url = match[2]?.trim() ?? "";

      // Remove optional title attribute, e.g. [text](url "title")
      const spaceIdx = url.indexOf(" ");
      if (spaceIdx > 0 && (url.endsWith('"') || url.endsWith("'"))) {
        url = url.slice(0, spaceIdx).trim();
      }

      const category = categorizeUrl(url);
      if (category === "other") continue;

      links.push({
        file: filePath,
        line: i + 1,
        text,
        url,
        isInternal: category === "internal",
      });
    }

    const imgRegex = /<img[^>]+src=["']([^"']+)["']/g;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imgRegex.exec(line)) !== null) {
      const url = imgMatch[1]?.trim() ?? "";
      const category = categorizeUrl(url);
      if (category === "other") continue;

      links.push({
        file: filePath,
        line: i + 1,
        text: "img",
        url,
        isInternal: category === "internal",
      });
    }
  }

  return links;
}

/** Resolves an internal link target to a disk file path, and optional anchor. */
export function resolveInternalLink(
  link: MarkdownLink,
  repoRoot: string,
  permalinkMap: Map<string, string>,
): { targetPath: string | null; anchor: string | null } {
  const [urlPath, anchor] = link.url.split("#") as [string, string | undefined];
  const cleanAnchor = anchor ? anchor.toLowerCase() : null;

  // Pure anchor link within the same file: #section
  if (!urlPath) {
    return { targetPath: link.file, anchor: cleanAnchor };
  }

  // Absolute site path (/rules/, /cli/)
  if (urlPath.startsWith("/")) {
    const permalinkTarget = permalinkMap.get(urlPath);
    if (permalinkTarget && existsSync(permalinkTarget)) {
      return { targetPath: permalinkTarget, anchor: cleanAnchor };
    }
    // Also try checking relative to repo root
    const rootRelative = join(repoRoot, urlPath.slice(1));
    if (existsSync(rootRelative)) {
      return { targetPath: rootRelative, anchor: cleanAnchor };
    }
    // Also try checking inside docs/
    const docsRelative = join(repoRoot, "docs", urlPath.slice(1));
    if (existsSync(docsRelative)) {
      return { targetPath: docsRelative, anchor: cleanAnchor };
    }
  }

  // Relative file path (e.g. ./foo.md, ../foo.md, docs/cli.md)
  const currentDir = dirname(link.file);
  const relativeCandidate = resolve(currentDir, urlPath);
  if (existsSync(relativeCandidate)) {
    return { targetPath: relativeCandidate, anchor: cleanAnchor };
  }

  // Candidate with .md appended
  if (!extname(urlPath)) {
    const mdCandidate = resolve(currentDir, `${urlPath}.md`);
    if (existsSync(mdCandidate)) {
      return { targetPath: mdCandidate, anchor: cleanAnchor };
    }
    const indexCandidate = resolve(currentDir, urlPath, "index.md");
    if (existsSync(indexCandidate)) {
      return { targetPath: indexCandidate, anchor: cleanAnchor };
    }
  }

  // Check from repo root if relativeCandidate failed
  const repoRelative = resolve(repoRoot, urlPath);
  if (existsSync(repoRelative)) {
    return { targetPath: repoRelative, anchor: cleanAnchor };
  }

  return { targetPath: null, anchor: cleanAnchor };
}

/**
 * Checks all internal markdown links across the provided files.
 */
export function checkInternalLinks(files: string[], repoRoot: string): BrokenLinkReport[] {
  const permalinkMap = buildPermalinkMap(join(repoRoot, "docs"));
  const broken: BrokenLinkReport[] = [];
  const headingCache = new Map<string, Set<string>>();

  function getHeadingsForFile(file: string): Set<string> {
    if (!headingCache.has(file)) {
      if (existsSync(file) && extname(file) === ".md") {
        headingCache.set(file, extractHeadings(readFileSync(file, "utf8")));
      } else {
        headingCache.set(file, new Set());
      }
    }
    return headingCache.get(file)!;
  }

  for (const file of files) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");

    // Validate YAML frontmatter if present
    if (content.startsWith("---")) {
      const parts = content.split("---");
      if (parts.length >= 3 && parts[1]) {
        try {
          parseYaml(parts[1]);
        } catch (err: unknown) {
          broken.push({
            file,
            line: 1,
            url: "frontmatter",
            reason: `Invalid YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }

    const links = extractMarkdownLinks(content, file);

    for (const link of links) {
      if (!link.isInternal) continue;

      const { targetPath, anchor } = resolveInternalLink(link, repoRoot, permalinkMap);

      if (!targetPath || !existsSync(targetPath)) {
        broken.push({
          file: link.file,
          line: link.line,
          url: link.url,
          reason: `Target file does not exist: "${link.url}"`,
        });
        continue;
      }

      if (anchor && extname(targetPath) === ".md") {
        const headings = getHeadingsForFile(targetPath);
        if (!headings.has(anchor)) {
          // Allow common standard anchors or continue if headings not strictly indexed
          const contentTarget = readFileSync(targetPath, "utf8");
          const hasCustomAnchor =
            contentTarget.includes(`id="${anchor}"`) ||
            contentTarget.includes(`id='${anchor}'`) ||
            contentTarget.includes(`{#${anchor}}`);
          if (!hasCustomAnchor && headings.size > 0 && !headings.has(anchor)) {
            broken.push({
              file: link.file,
              line: link.line,
              url: link.url,
              reason: `Heading anchor "#${anchor}" not found in ${targetPath}`,
            });
          }
        }
      }
    }
  }

  return broken;
}

/** Checks external links asynchronously and reports any unreachable URLs. */
export async function checkExternalLinks(files: string[], timeoutMs = 5000): Promise<BrokenLinkReport[]> {
  const broken: BrokenLinkReport[] = [];
  const checked = new Map<string, { ok: boolean; status?: number; error?: string }>();

  const allLinks: MarkdownLink[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    allLinks.push(...extractMarkdownLinks(content, file).filter((l) => !l.isInternal));
  }

  for (const link of allLinks) {
    if (checked.has(link.url)) {
      const prev = checked.get(link.url)!;
      if (!prev.ok) {
        broken.push({
          file: link.file,
          line: link.line,
          url: link.url,
          reason: prev.error ?? `HTTP ${prev.status}`,
        });
      }
      continue;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(link.url, {
        method: "HEAD",
        signal: controller.signal,
        headers: { "User-Agent": "ebb-link-checker/1.0" },
      });
      clearTimeout(timer);

      if (res.status >= 400 && res.status !== 403 && res.status !== 401) {
        // Retry with GET if HEAD is not supported by target server
        const getController = new AbortController();
        const getTimer = setTimeout(() => getController.abort(), timeoutMs);
        const getRes = await fetch(link.url, {
          method: "GET",
          signal: getController.signal,
          headers: { "User-Agent": "ebb-link-checker/1.0" },
        });
        clearTimeout(getTimer);

        if (getRes.status >= 400 && getRes.status !== 403 && getRes.status !== 401) {
          checked.set(link.url, { ok: false, status: getRes.status });
          broken.push({
            file: link.file,
            line: link.line,
            url: link.url,
            reason: `HTTP ${getRes.status}`,
          });
          continue;
        }
      }

      checked.set(link.url, { ok: true, status: res.status });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      checked.set(link.url, { ok: false, error: message });
      broken.push({
        file: link.file,
        line: link.line,
        url: link.url,
        reason: message,
      });
    }
  }

  return broken;
}

/**
 * CLI runner for markdown link verification.
 */
export async function runMarkdownCli(args: string[]): Promise<number> {
  const repoRoot = resolve(process.cwd());
  const checkInternal = args.includes("--check-internal") || (!args.includes("--check-external") && args.length === 0);
  const checkExternal = args.includes("--check-external");

  function getMarkdownFiles(dir: string): string[] {
    const list: string[] = [];
    if (!existsSync(dir)) return list;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
        list.push(...getMarkdownFiles(full));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        list.push(full);
      }
    }
    return list;
  }

  const files = [resolve(repoRoot, "README.md"), ...getMarkdownFiles(resolve(repoRoot, "docs"))];

  if (checkInternal) {
    const broken = checkInternalLinks(files, repoRoot);
    if (broken.length > 0) {
      process.stderr.write(`\n❌ Found ${broken.length} broken internal markdown links:\n`);
      for (const item of broken) {
        const rel = item.file.replace(`${repoRoot}/`, "");
        process.stderr.write(`  ${rel}:${item.line} -> "${item.url}" (${item.reason})\n`);
      }
      return 1;
    }
    process.stdout.write(`✔ All internal documentation links verified across ${files.length} markdown files.\n`);
  }

  if (checkExternal) {
    process.stdout.write(`ℹ Scanning external links across ${files.length} markdown files (non-blocking report)...\n`);
    const brokenExternal = await checkExternalLinks(files);
    if (brokenExternal.length > 0) {
      process.stdout.write(`⚠ Found ${brokenExternal.length} potentially broken external links:\n`);
      for (const item of brokenExternal) {
        const rel = item.file.replace(`${repoRoot}/`, "");
        process.stdout.write(`  ${rel}:${item.line} -> "${item.url}" (${item.reason})\n`);
      }
    } else {
      process.stdout.write(`✔ All external documentation links reachable.\n`);
    }
  }

  return 0;
}

const arg1 = process.argv[1];
const isMain =
  typeof arg1 === "string" &&
  (arg1 === import.meta.filename || arg1.endsWith("/markdown.js") || arg1.endsWith("/markdown.ts"));

if (isMain) {
  runMarkdownCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
