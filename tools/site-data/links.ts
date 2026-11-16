import { DEFAULT_STATIC_API_BASE_URL, purlToApiPath } from "../../src/api.js";
import { purlIdentity } from "../../src/purl.js";
import type { ComponentRecord } from "./components.js";
import type { ReleaseLineRecord } from "./lines.js";
import type { RuleRecord } from "./rules.js";

export interface LinkResolutionOptions {
  baseUrl?: string | undefined;
}

export function resolveLinks(
  components: Map<string, ComponentRecord>,
  rules: Map<string, RuleRecord>,
  lines: ReleaseLineRecord[],
  ruleEcosystemMap: Map<string, string>,
  options?: LinkResolutionOptions,
): void {
  const baseUrl = (options?.baseUrl ?? DEFAULT_STATIC_API_BASE_URL).replace(/\/+$/, "");

  // Build lookups for fast resolution
  const componentsByPurl = new Map<string, ComponentRecord>();
  const componentsByName = new Map<string, ComponentRecord>();
  const linesByCompPurl = new Map<string, ReleaseLineRecord[]>();

  for (const comp of components.values()) {
    componentsByPurl.set(comp.purl, comp);
    componentsByName.set(comp.name.toLowerCase(), comp);
  }

  for (const line of lines) {
    const compPurl = line.id.split("#")[0]!;
    if (!linesByCompPurl.has(compPurl)) {
      linesByCompPurl.set(compPurl, []);
    }
    linesByCompPurl.get(compPurl)!.push(line);
  }

  // 1. Link components to their rules and release lines
  for (const comp of components.values()) {
    const ruleSlugs = comp.rules
      .map((ruleId) => rules.get(ruleId)?.slug)
      .filter((s): s is string => Boolean(s))
      .sort();

    const lineRecords = linesByCompPurl.get(comp.purl) ?? [];
    const lineSlugs = lineRecords.map((l) => l.slug).sort();

    comp.links = {
      rules: ruleSlugs,
      lines: lineSlugs,
      apiUrl: `${baseUrl}/${purlToApiPath(comp.purl)}`,
      sourcePath: `registry/${comp.ecosystem}.json`,
    };
  }

  // 2. Link rules to component and replacement component (only if known in Ebb)
  for (const rule of rules.values()) {
    const eco = ruleEcosystemMap.get(rule.id) ?? "generic";

    // Find the owning component
    let owningComp: ComponentRecord | undefined;
    for (const comp of components.values()) {
      if (comp.rules.includes(rule.id)) {
        owningComp = comp;
        break;
      }
    }

    const componentSlug = owningComp?.slug ?? "";

    // Find replacement component if known in Ebb
    let replacementComponentSlug: string | undefined;
    if (rule.replacement) {
      const rep = rule.replacement.trim();
      if (rep.startsWith("pkg:")) {
        try {
          const repIdentity = purlIdentity(rep);
          const found = componentsByPurl.get(repIdentity);
          if (found) {
            replacementComponentSlug = found.slug;
          }
        } catch {
          // ignore
        }
      } else {
        const found = componentsByName.get(rep.toLowerCase());
        if (found) {
          replacementComponentSlug = found.slug;
        }
      }
    }

    rule.links = {
      component: componentSlug,
      ...(replacementComponentSlug ? { replacementComponent: replacementComponentSlug } : {}),
      apiUrl: `${baseUrl}/rules/${encodeURIComponent(rule.id)}.json`,
      sourcePath: `registry/${eco}.json`,
    };
  }

  // 3. Link release lines to component and rule
  for (const line of lines) {
    const compPurl = line.id.split("#")[0]!;
    const comp = componentsByPurl.get(compPurl);
    const rule = rules.get(line.ruleId);
    const eco = comp?.ecosystem ?? "generic";

    line.links = {
      component: comp?.slug ?? "",
      rule: rule?.slug ?? "",
      apiUrl: comp ? `${baseUrl}/${purlToApiPath(comp.purl)}` : `${baseUrl}/all.json`,
      sourcePath: `registry/${eco}.json`,
    };
  }
}
