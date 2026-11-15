// Matches dates in common human-written and ISO formats for source verification.

const MONTHS: readonly { long: string; short: string }[] = [
  { long: "January", short: "Jan" },
  { long: "February", short: "Feb" },
  { long: "March", short: "Mar" },
  { long: "April", short: "Apr" },
  { long: "May", short: "May" },
  { long: "June", short: "Jun" },
  { long: "July", short: "Jul" },
  { long: "August", short: "Aug" },
  { long: "September", short: "Sep" },
  { long: "October", short: "Oct" },
  { long: "November", short: "Nov" },
  { long: "December", short: "Dec" },
];

/** Builds regex patterns for a YYYY-MM-DD date across ISO, long-month, short-month, and day-first forms. */
export function buildDatePatterns(isoDate: string): RegExp[] {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return [];
  const year = parts[0]!;
  const monthIdx = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  if (monthIdx < 0 || monthIdx > 11 || Number.isNaN(day)) return [];

  const month = MONTHS[monthIdx]!;
  const monthNum = String(monthIdx + 1);
  const monthNumPadded = parts[1]!;
  const dayStr = String(day);
  const dayPadded = parts[2]!;

  const patterns: RegExp[] = [
    // 1. ISO variants: 2026-04-30, 2026/04/30, 2026.04.30
    new RegExp(`\\b${year}[-/.]${monthNumPadded}[-/.]${dayPadded}\\b`),

    // 2. Long month: "April 30, 2026", "April 30th, 2026", "30 April 2026", "30th April 2026"
    new RegExp(`\\b${month.long}\\s+${dayStr}(?:st|nd|rd|th)?,?\\s+${year}\\b`, "i"),
    new RegExp(`\\b${dayStr}(?:st|nd|rd|th)?\\s+${month.long},?\\s+${year}\\b`, "i"),

    // 3. Short month: "Apr 30, 2026", "Apr. 30, 2026", "30 Apr 2026", "30-Apr-2026", "30th Apr 2026"
    new RegExp(`\\b${month.short}\\.?\\s+${dayStr}(?:st|nd|rd|th)?,?\\s+${year}\\b`, "i"),
    new RegExp(`\\b${dayStr}(?:st|nd|rd|th)?\\s+${month.short}\\.?,?\\s+${year}\\b`, "i"),
    new RegExp(`\\b${dayStr}-${month.short}-${year}\\b`, "i"),
    new RegExp(`\\b${dayPadded}-${month.short}-${year}\\b`, "i"),

    // 4. Day first numeric: "30/04/2026", "30-04-2026", "30.04.2026", "30/4/2026"
    new RegExp(`\\b${dayPadded}[-/.]${monthNumPadded}[-/.]${year}\\b`),
    new RegExp(`\\b${dayStr}[-/.]${monthNum}[-/.]${year}\\b`),
  ];

  return patterns;
}

/** Returns true if text (HTML or plain text) contains the target ISO date in any common format. */
export function containsDate(text: string, isoDate: string): boolean {
  if (!text || !isoDate) return false;
  const patterns = buildDatePatterns(isoDate);
  if (patterns.length === 0) return false;

  // Check raw text first
  for (const pattern of patterns) {
    if (pattern.test(text)) return true;
  }

  // Strip HTML tags and normalize whitespace for tags breaking up dates
  const stripped = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  for (const pattern of patterns) {
    if (pattern.test(stripped)) return true;
  }

  return false;
}
