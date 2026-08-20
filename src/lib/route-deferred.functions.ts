// Phase A — catch-up queue for assets trimmed out of a plan by the daily hour cap.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DeferredRow = {
  id: string;
  code: string;
  planName: string | null;
  inspectorIndex: number | null;
  inspectorName: string | null;
  dayIndex: number | null;
  reason: string | null;
  riskLevel: string | null;
  deferredAt: string;
};

export type DeferredInput = {
  code: string;
  planName?: string | null;
  inspectorIndex?: number | null;
  inspectorName?: string | null;
  dayIndex?: number | null;
  reason?: string | null;
  riskLevel?: string | null;
};

/** Open (not yet re-visited) deferred assets, newest first. */
export const listDeferredAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("route_deferred_assets")
      .select(
        "id, asset_old_code, plan_name, inspector_index, inspector_name, day_index, reason, risk_level, deferred_at",
      )
      .is("cleared_at", null)
      .order("deferred_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    const rows: DeferredRow[] = (data ?? []).map((r) => ({
      id: r.id,
      code: r.asset_old_code,
      planName: r.plan_name,
      inspectorIndex: r.inspector_index,
      inspectorName: r.inspector_name,
      dayIndex: r.day_index,
      reason: r.reason,
      riskLevel: r.risk_level,
      deferredAt: r.deferred_at,
    }));
    return { rows };
  });

/** Record assets that were trimmed from the current plan. Codes already open are skipped. */
export const saveDeferredAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { items: DeferredInput[] }) => {
    const items = Array.isArray(input?.items) ? input.items : [];
    if (items.length === 0) throw new Error("no items");
    if (items.length > 2000) throw new Error("too many items");
    for (const it of items) {
      if (!it?.code || typeof it.code !== "string") throw new Error("invalid code");
    }
    return { items };
  })
  .handler(async ({ data, context }) => {
    const codes = Array.from(new Set(data.items.map((i) => i.code)));
    const { data: existing } = await context.supabase
      .from("route_deferred_assets")
      .select("asset_old_code")
      .is("cleared_at", null)
      .in("asset_old_code", codes);
    const have = new Set((existing ?? []).map((r) => r.asset_old_code));

    const rows = data.items
      .filter((i) => !have.has(i.code))
      .map((i) => ({
        asset_old_code: i.code,
        plan_name: i.planName ?? null,
        inspector_index: i.inspectorIndex ?? null,
        inspector_name: i.inspectorName ?? null,
        day_index: i.dayIndex ?? null,
        reason: i.reason ?? null,
        risk_level: i.riskLevel ?? null,
      }));
    if (rows.length === 0) return { inserted: 0 };

    const { error } = await context.supabase.from("route_deferred_assets").insert(rows);
    if (error) throw new Error(error.message);
    return { inserted: rows.length };
  });

/** Mark deferred assets as handled (all open ones, or a specific code list). */
export const clearDeferredAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { codes?: string[] } | undefined) => ({
    codes: Array.isArray(input?.codes) ? input!.codes!.slice(0, 2000) : null,
  }))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("route_deferred_assets")
      .update({ cleared_at: new Date().toISOString() })
      .is("cleared_at", null);
    if (data.codes && data.codes.length) q = q.in("asset_old_code", data.codes);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });
