// Pure classifier shared between RCA tabs.
// Given free-text from a claim/breakdown record and a list of diagram_mappings
// (category + keywords), returns the best-matching category, where "best" means
// the category whose keywords appear the most times in the text.
//
// Designed to be deterministic, case-insensitive, Thai+English safe (uses
// simple substring), and tolerant of empty input.

export type DiagramMapping = {
  category: string;
  label: string;
  keywords: string[] | null;
  enabled?: boolean | null;
};

export type ClassifyResult = {
  category: string;
  label: string;
  matchedKeywords: string[];
};

export function classifyText(
  text: string,
  mappings: DiagramMapping[],
): ClassifyResult | null {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return null;
  let best: ClassifyResult | null = null;
  for (const m of mappings) {
    if (m.enabled === false) continue;
    const kws = (m.keywords ?? [])
      .filter((k): k is string => typeof k === "string" && k.length > 0)
      .map((k) => k.toLowerCase());
    const hits: string[] = [];
    for (const k of kws) if (t.includes(k)) hits.push(k);
    if (hits.length === 0) continue;
    if (!best || hits.length > best.matchedKeywords.length) {
      best = { category: m.category, label: m.label, matchedKeywords: hits };
    }
  }
  return best;
}

export function buildClaimText(r: {
  problem_category?: string | null;
  problem_equipment?: string | null;
  problem_detail?: string | null;
  inform_detail?: string | null;
}): string {
  return [r.problem_category, r.problem_equipment, r.problem_detail, r.inform_detail]
    .filter(Boolean)
    .join(" ");
}
