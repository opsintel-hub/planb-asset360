// Phase 5 — Asset risk scores.
// Reads the pre-computed `asset_risk_scores` table (refreshed nightly by the
// database function `recompute_asset_risk_scores`). No AI, no paid API.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RiskLevel = "high" | "medium" | "low";

export type AssetRisk = {
  code: string;
  level: RiskLevel;
  score: number;
  claims30d: number;
  claims90d: number;
  claims365d: number;
  openClaims: number;
  lastClaimAt: string | null;
  lastPmAt: string | null;
  daysSincePm: number | null;
  topProblem: string | null;
};

const COLUMNS =
  "asset_old_code, risk_level, score, claims_30d, claims_90d, claims_365d, open_claims, last_claim_at, last_pm_at, days_since_pm, top_problem";

type Row = {
  asset_old_code: string;
  risk_level: string | null;
  score: number | null;
  claims_30d: number | null;
  claims_90d: number | null;
  claims_365d: number | null;
  open_claims: number | null;
  last_claim_at: string | null;
  last_pm_at: string | null;
  days_since_pm: number | null;
  top_problem: string | null;
};

function toRisk(r: Row): AssetRisk {
  const lvl = r.risk_level === "high" || r.risk_level === "medium" ? r.risk_level : "low";
  return {
    code: r.asset_old_code,
    level: lvl,
    score: r.score ?? 0,
    claims30d: r.claims_30d ?? 0,
    claims90d: r.claims_90d ?? 0,
    claims365d: r.claims_365d ?? 0,
    openClaims: r.open_claims ?? 0,
    lastClaimAt: r.last_claim_at,
    lastPmAt: r.last_pm_at,
    daysSincePm: r.days_since_pm,
    topProblem: r.top_problem,
  };
}

/**
 * Risk scores worth showing. Anything not returned is "low with no signal",
 * so the payload stays tiny even with thousands of assets.
 */
export const listAssetRiskScores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { minScore?: number } | undefined) => ({
    minScore: Math.max(0, Math.min(100, input?.minScore ?? 1)),
  }))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("asset_risk_scores")
      .select(COLUMNS)
      .gte("score", data.minScore)
      .order("score", { ascending: false })
      .limit(20000);
    if (error) throw error;
    const list = ((rows ?? []) as Row[]).map(toRisk);
    return {
      rows: list,
      counts: {
        high: list.filter((r) => r.level === "high").length,
        medium: list.filter((r) => r.level === "medium").length,
      },
    };
  });

/** Full risk detail for one asset — used by Asset History / asset popups. */
export const getAssetRisk = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => ({ code: String(input.code ?? "").trim() }))
  .handler(async ({ data, context }) => {
    if (!data.code) return { risk: null as AssetRisk | null };
    const { data: row, error } = await context.supabase
      .from("asset_risk_scores")
      .select(COLUMNS)
      .eq("asset_old_code", data.code)
      .maybeSingle();
    if (error) throw error;
    return { risk: row ? toRisk(row as Row) : null };
  });

/** Admin-only manual refresh (the nightly cron does this automatically). */
export const recomputeAssetRiskScores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("recompute_asset_risk_scores");
    if (error) throw error;
    return { rows: (data as number | null) ?? 0 };
  });
