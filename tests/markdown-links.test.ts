import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { checkInternalLinks, extractHeadings, extractMarkdownLinks, slugifyHeading } from "../tools/markdown.js";

const repoRoot = resolve(process.cwd());

describe("Markdown Link Verification Suite (Issue #575)", () => {
  it("slugifies markdown headings with punctuation and spacing", () => {
    assert.equal(slugifyHeading("Quick Start"), "quick-start");
    assert.equal(
      slugifyHeading("1. Library Quickstart (TypeScript / JavaScript)"),
      "1-library-quickstart-typescript-javascript",
    );
    assert.equal(slugifyHeading("Why Ebb"), "why-ebb");
  });

  it("extracts markdown headings and alternative slug variants", () => {
    const md = `
# Ebb Documentation
## 1. Library Quickstart (TypeScript / JavaScript)
### AI Agent Quickstart (MCP & Skills)
`;
    const headings = extractHeadings(md);
    assert.ok(headings.has("ebb-documentation"));
    assert.ok(headings.has("1-library-quickstart-typescript-javascript"));
    assert.ok(headings.has("1-library-quickstart-typescript--javascript"));
    assert.ok(headings.has("ai-agent-quickstart-mcp--skills"));
  });

  it("extracts markdown links with line numbers and internal flag", () => {
    const md = `
[Quickstart](docs/QUICKSTART.md)
[External Link](https://example.com)
\`\`\`bash
[Ignored in code block](foo.md)
\`\`\`
[CLI Guide](/cli/)
`;
    const links = extractMarkdownLinks(md, "test.md");
    assert.equal(links.length, 3);
    assert.equal(links[0]?.url, "docs/QUICKSTART.md");
    assert.equal(links[0]?.isInternal, true);
    assert.equal(links[1]?.url, "https://example.com");
    assert.equal(links[1]?.isInternal, false);
    assert.equal(links[2]?.url, "/cli/");
    assert.equal(links[2]?.isInternal, true);
  });

  it("verifies that repository README and docs contain zero broken internal links", () => {
    const files = [
      resolve(repoRoot, "README.md"),
      resolve(repoRoot, "docs/index.md"),
      resolve(repoRoot, "docs/trust.md"),
      resolve(repoRoot, "docs/compare.md"),
    ];
    const broken = checkInternalLinks(files, repoRoot);
    assert.deepEqual(broken, [], `Found broken links: ${JSON.stringify(broken, null, 2)}`);
  });
});
