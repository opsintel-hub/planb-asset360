// Phase 5 — Asset risk scores.
// Reads the pre-computed `asset_risk_scores` table (refreshed nightly by the
// database function `recompute_asset_risk_scores`). No AI, no paid API.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RiskLevel = "critical" | "high" | "medium" | "low";

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
  department: string | null;
  mediaType: string | null;
  district: string | null;
};

export type AssetHistoryEvent = {
  refNumber: string | null;
  type: "Claim" | "PM";
  eventAt: string;
  status: string | null;
  problemCategory: string | null;
  problemEquipment: string | null;
  solutionDetail: string | null;
};

export type AssetHistorySummary = {
  claimTotal: number;
  pmTotal: number;
  claimAveragePerMonth: number;
  pmAveragePerMonth: number;
  events: AssetHistoryEvent[];
  generatedAt: string;
};

const COLUMNS =
  "asset_old_code, risk_level, score, claims_30d, claims_90d, claims_365d, open_claims, last_claim_at, last_pm_at, days_since_pm, top_problem, department, media_type, district";

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
  department: string | null;
  media_type: string | null;
  district: string | null;
};

function toRisk(r: Row): AssetRisk {
  const lvl: RiskLevel =
    r.risk_level === "critical" || r.risk_level === "high" || r.risk_level === "medium"
      ? r.risk_level
      : "low";
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
    department: r.department,
    mediaType: r.media_type,
    district: r.district,
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
        critical: list.filter((r) => r.level === "critical").length,
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

/** Actual Claim and PM events for the executive 360-day report. */
export const getAssetHistorySummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => ({ code: String(input.code ?? "").trim() }))
  .handler(async ({ data, context }) => {
    const empty: AssetHistorySummary = {
      claimTotal: 0,
      pmTotal: 0,
      claimAveragePerMonth: 0,
      pmAveragePerMonth: 0,
      events: [],
      generatedAt: new Date().toISOString(),
    };
    if (!data.code) return { summary: empty };

    const cutoff = new Date(Date.now() - 360 * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await context.supabase
      .from("mv_pm_history")
      .select("ref_number,type,event_ts,status,problem_category,problem_equipment,solution_detail")
      .eq("asset_old_code", data.code)
      .in("type", ["Claim", "PM"])
      .gte("event_ts", cutoff)
      .order("event_ts", { ascending: false })
      .limit(500);
    if (error) throw error;

    type HistoryRow = {
      ref_number: string | null;
      type: string | null;
      event_ts: string | null;
      status: string | null;
      problem_category: string | null;
      problem_equipment: string | null;
      solution_detail: string | null;
    };
    const events = ((rows ?? []) as HistoryRow[])
      .filter((row): row is HistoryRow & { event_ts: string } => !!row.event_ts && (row.type === "Claim" || row.type === "PM"))
      .map((row) => ({
        refNumber: row.ref_number,
        type: row.type as "Claim" | "PM",
        eventAt: row.event_ts,
        status: row.status,
        problemCategory: row.problem_category,
        problemEquipment: row.problem_equipment,
        solutionDetail: row.solution_detail,
      }));
    const claimTotal = events.filter((event) => event.type === "Claim").length;
    const pmTotal = events.filter((event) => event.type === "PM").length;
    return {
      summary: {
        claimTotal,
        pmTotal,
        claimAveragePerMonth: Math.round((claimTotal / 12) * 10) / 10,
        pmAveragePerMonth: Math.round((pmTotal / 12) * 10) / 10,
        events,
        generatedAt: new Date().toISOString(),
      } satisfies AssetHistorySummary,
    };
  });

/**
 * Live open-claim counts per asset (from claim_tickets, synced every 15 min).
 * The risk table itself is only recomputed nightly, so the UI merges this in
 * to keep "เคลมค้างเปิด" consistent with Claim Aging.
 */
export const listOpenClaimCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("claim_tickets")
      .select("asset_old_code")
      .not("asset_old_code", "is", null)
      .limit(20000);
    if (error) throw error;
    const counts: Record<string, number> = {};
    for (const r of (rows ?? []) as { asset_old_code: string | null }[]) {
      const code = (r.asset_old_code ?? "").trim();
      if (!code) continue;
      counts[code] = (counts[code] ?? 0) + 1;
    }
    return { counts };
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
