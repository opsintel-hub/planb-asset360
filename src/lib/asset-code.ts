/**
 * Asset code normalization shared by CRM matching and asset lookups.
 *
 * CRM and MSSQL spell the same asset differently ("MTP-A23" vs "MTP A23" vs
 * "mtp_a23"), so every join on asset codes compares the normalized form:
 * uppercase, with all separators/whitespace stripped.
 */
export function normalizeAssetCode(code: string | null | undefined): string {
  if (!code) return "";
  return code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/** Map of normalized code -> canonical asset old_code. First win keeps order stable. */
export function buildAssetCodeIndex(codes: Array<string | null | undefined>): Map<string, string> {
  const index = new Map<string, string>();
  for (const c of codes) {
    if (!c) continue;
    const n = normalizeAssetCode(c);
    if (n && !index.has(n)) index.set(n, c);
  }
  return index;
}
