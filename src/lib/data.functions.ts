import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runAssetHistorySync } from "./sync.server";

// ---------- Dashboard ----------
export const getDashboardOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    const [assetsRes, claimsRes, monitorRes, historyRes] = await Promise.all([
      supabase.from("assets").select("id, department, status", { count: "exact" }),
      supabase.from("claims").select("id, sla_status, age_hours", { count: "exact" }),
      supabase.from("monitoring_status").select("online, error_code"),
      supabase
        .from("asset_history")
        .select("id, type, title, status, opened_at, ticket_code, asset_old_code")
        .order("opened_at", { ascending: false })
        .limit(15),
    ]);

    const assets = assetsRes.data ?? [];
    const claims = claimsRes.data ?? [];
    const monitor = monitorRes.data ?? [];
    const history = historyRes.data ?? [];

    // by department
    const deptMap = new Map<string, number>();
    for (const a of assets) {
      const k = a.department ?? "Unknown";
      deptMap.set(k, (deptMap.get(k) ?? 0) + 1);
    }
    const deptData = Array.from(deptMap, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    // status pie
    const statusMap = new Map<string, number>();
    for (const a of assets) {
      const k = a.status ?? "Unknown";
      statusMap.set(k, (statusMap.get(k) ?? 0) + 1);
    }
    const total = assets.length || 1;
    const colorFor = (s: string) =>
      s.toLowerCase().includes("finish") || s.toLowerCase().includes("ok")
        ? "oklch(0.65 0.16 155)"
        : s.toLowerCase().includes("work")
          ? "oklch(0.62 0.19 255)"
          : s.toLowerCase().includes("pend")
            ? "oklch(0.78 0.16 75)"
            : "oklch(0.6 0.22 25)";
    const statusData = Array.from(statusMap, ([name, value]) => ({
      name,
      value: Math.round((value / total) * 100),
      color: colorFor(name),
    }));

    // trend (last 5 months)
    const now = new Date();
    const monthLabels: string[] = [];
    const trendBuckets: Record<string, { pm: number; claim: number; monitor: number }> = {};
    for (let i = 4; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("th-TH", { month: "short" });
      monthLabels.push(label);
      trendBuckets[key] = { pm: 0, claim: 0, monitor: 0 };
    }
    const { data: histAll } = await supabase
      .from("asset_history")
      .select("type, opened_at")
      .gte("opened_at", new Date(now.getFullYear(), now.getMonth() - 4, 1).toISOString());
    for (const h of histAll ?? []) {
      if (!h.opened_at) continue;
      const d = new Date(h.opened_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = trendBuckets[key];
      if (!b) continue;
      if (h.type === "PM") b.pm++;
      else if (h.type === "Claim") b.claim++;
      else if (h.type === "Monitor") b.monitor++;
    }
    const trendData = monthLabels.map((label, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (4 - i), 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = trendBuckets[key];
      return { month: label, ...b };
    });

    // stats
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const { count: pmThisMonth } = await supabase
      .from("asset_history")
      .select("id", { count: "exact", head: true })
      .eq("type", "PM")
      .gte("opened_at", monthStart);

    const avgClaimAge = claims.length
      ? claims.reduce((s, c) => s + (Number(c.age_hours) || 0), 0) / claims.length / 24
      : 0;
    const errorCount = monitor.filter((m) => !m.online).length;

    return {
      stats: {
        totalAssets: assetsRes.count ?? 0,
        pmThisMonth: pmThisMonth ?? 0,
        claimsOpen: claimsRes.count ?? 0,
        avgClaimDays: Math.round(avgClaimAge * 10) / 10,
        monitorErrors: errorCount,
      },
      deptData,
      statusData,
      trendData,
      recent: history.map((h) => ({
        id: h.ticket_code ?? h.id,
        type: h.type,
        status: h.status ?? "—",
        title: h.title ?? "",
        opened_at: h.opened_at,
        asset_old_code: h.asset_old_code,
      })),
    };
  });

// ---------- Search ----------
export const searchAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        q: z.string().max(200).optional().default(""),
        tab: z.enum(["PM", "Claim", "Monitor", "AssetHealth"]).optional().default("PM"),
        limit: z.number().int().min(1).max(200).optional().default(50),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const q = data.q.trim();
    let assetsQuery = supabase
      .from("assets")
      .select("id, old_code, name, department, area, status, last_pm_at, last_claim_at, last_monitor_ok_at")
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (q) {
      assetsQuery = assetsQuery.or(
        `old_code.ilike.%${q}%,name.ilike.%${q}%,area.ilike.%${q}%`,
      );
    }
    const { data: assets } = await assetsQuery;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let history: any[] = [];
    if (assets && assets.length) {
      const ids = assets.map((a) => a.id);
      const { data: h } = await supabase
        .from("asset_history")
        .select("id, asset_id, ticket_code, type, title, status, opened_at, closed_at, sla_hours")
        .in("asset_id", ids)
        .eq("type", data.tab)
        .order("opened_at", { ascending: false })
        .limit(200);
      history = h ?? [];
    }
    return { assets: assets ?? [], history };
  });

// Autocomplete: lightweight list for combobox (supports pre-filter by dept/region/mediaType)
export const autocompleteAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      q: z.string().max(200).optional().default(""),
      limit: z.number().int().min(1).max(50).optional().default(20),
      department: z.string().optional(),
      region: z.string().optional(),
      mediaType: z.string().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const q = data.q.trim();
    let query = supabase
      .from("assets")
      .select("id, old_code, name, area, department, status, payload")
      .order("old_code", { ascending: true })
      .limit(data.mediaType ? 200 : data.limit); // over-fetch when filtering by jsonb
    if (q) {
      query = query.or(`old_code.ilike.%${q}%,name.ilike.%${q}%,area.ilike.%${q}%`);
    }
    if (data.department) query = query.eq("department", data.department);
    if (data.region) query = query.eq("area", data.region);
    const { data: rowsRaw, error } = await query;
    if (error) return { rows: [], error: error.message };
    let rows = rowsRaw ?? [];
    if (data.mediaType) {
      rows = rows.filter((r) => {
        const p = r.payload as Record<string, unknown> | null;
        const mt = (p?.mediaType ?? p?.MediaType) as string | undefined;
        return String(mt ?? "") === data.mediaType;
      }).slice(0, data.limit);
    }
    return { rows, error: null };
  });

// Global filter options across ALL assets (for pre-filter UI)
export const getFilterOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("assets")
      .select("department, area, payload")
      .limit(5000);
    const depts = new Set<string>();
    const regions = new Set<string>();
    const mediaTypes = new Set<string>();
    for (const r of data ?? []) {
      if (r.department) depts.add(r.department);
      if (r.area) regions.add(r.area);
      const p = r.payload as Record<string, unknown> | null;
      const mt = (p?.mediaType ?? p?.MediaType) as string | undefined;
      if (mt) mediaTypes.add(String(mt));
    }
    return {
      departments: Array.from(depts).sort(),
      regions: Array.from(regions).sort(),
      mediaTypes: Array.from(mediaTypes).sort(),
    };
  });

// Fetch one asset + history; auto-sync from PlanB if local history is empty (or forced)
export const getAssetWithHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      oldCode: z.string().min(1).max(100),
      tab: z.enum(["PM", "Claim", "Monitor", "AssetHealth"]).optional().default("PM"),
      forceSync: z.boolean().optional().default(false),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: asset } = await supabase
      .from("assets")
      .select("id, old_code, name, department, area, status, last_pm_at, last_claim_at, last_monitor_ok_at")
      .eq("old_code", data.oldCode)
      .maybeSingle();
    if (!asset) return { asset: null, history: [], synced: false, syncError: null };

    const { count } = await supabase
      .from("asset_history")
      .select("id", { count: "exact", head: true })
      .eq("asset_id", asset.id);

    let synced = false;
    let syncError: string | null = null;
    if (data.forceSync || (count ?? 0) === 0) {
      try {
        await runAssetHistorySync(data.oldCode);
        synced = true;
      } catch (e) {
        syncError = (e as Error).message;
      }
    }

    const { data: history } = await supabase
      .from("asset_history")
      .select("id, ticket_code, type, title, status, opened_at, closed_at, sla_hours")
      .eq("asset_id", asset.id)
      .eq("type", data.tab)
      .order("opened_at", { ascending: false })
      .limit(200);
    return { asset, history: history ?? [], synced, syncError };
  });

// Comparison: fetch up to 5 assets + history filtered by tab + date range + slicers.
// Auto-syncs from PlanB for any asset with no local history (best-effort, non-blocking errors).
export const getAssetsComparison = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      oldCodes: z.array(z.string().min(1).max(100)).min(1).max(5),
      tab: z.enum(["PM", "Claim", "Monitor", "AssetHealth"]).optional().default("PM"),
      from: z.string().optional(),
      to: z.string().optional(),
      department: z.string().optional(),
      region: z.string().optional(),
      mediaType: z.string().optional(),
      forceSync: z.boolean().optional().default(false),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: assets } = await supabase
      .from("assets")
      .select("id, old_code, name, department, area, status, payload, last_pm_at, last_claim_at, last_monitor_ok_at, latitude, longitude, installed_at")
      .in("old_code", data.oldCodes);
    const list = assets ?? [];

    // Sync missing
    const syncErrors: Record<string, string> = {};
    for (const code of data.oldCodes) {
      const a = list.find((x) => x.old_code === code);
      const needsSync = data.forceSync || !a;
      if (needsSync || a) {
        const { count } = a
          ? await supabase.from("asset_history").select("id", { count: "exact", head: true }).eq("asset_id", a.id)
          : { count: 0 };
        if (data.forceSync || (count ?? 0) === 0) {
          try { await runAssetHistorySync(code); } catch (e) { syncErrors[code] = (e as Error).message; }
        }
      }
    }

    // re-fetch assets in case sync created any
    const { data: assets2 } = await supabase
      .from("assets")
      .select("id, old_code, name, department, area, status, payload, last_pm_at, last_claim_at, last_monitor_ok_at, latitude, longitude, installed_at")
      .in("old_code", data.oldCodes);
    const finalAssets = assets2 ?? [];

    const ids = finalAssets.map((a) => a.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let history: any[] = [];

    if (ids.length) {
      let q = supabase
        .from("asset_history")
        .select("id, asset_id, asset_old_code, ticket_code, type, title, status, opened_at, closed_at, sla_hours, payload")
        .in("asset_id", ids)
        .order("opened_at", { ascending: false })
        .limit(2000);
      if (data.tab !== "AssetHealth") q = q.eq("type", data.tab);
      if (data.from) q = q.gte("opened_at", data.from);
      if (data.to) q = q.lte("opened_at", data.to);
      const { data: h } = await q;
      history = h ?? [];
    }

    // slicer filter (in-memory; reads asset's department/area/payload.mediaType)
    const filtered = finalAssets.filter((a) => {
      if (data.department && (a.department ?? "") !== data.department) return false;
      if (data.region && (a.area ?? "") !== data.region) return false;
      if (data.mediaType) {
        const mt = (a.payload as Record<string, unknown> | null)?.mediaType ?? (a.payload as Record<string, unknown> | null)?.MediaType;
        if (String(mt ?? "") !== data.mediaType) return false;
      }
      return true;
    });

    // available slicer values across all selected assets
    const departments = Array.from(new Set(finalAssets.map((a) => a.department).filter(Boolean))) as string[];
    const regions = Array.from(new Set(finalAssets.map((a) => a.area).filter(Boolean))) as string[];
    const mediaTypes = Array.from(new Set(finalAssets.map((a) => {
      const p = a.payload as Record<string, unknown> | null;
      return (p?.mediaType ?? p?.MediaType) as string | undefined;
    }).filter(Boolean))) as string[];

    return {
      assets: filtered,
      history,
      slicers: { departments, regions, mediaTypes },
      syncErrors,
    };
  });

export const getAssetDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ oldCode: z.string().min(1).max(100) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: asset } = await supabase
      .from("assets")
      .select("*")
      .eq("old_code", data.oldCode)
      .maybeSingle();
    if (!asset) return { asset: null, history: [] };
    const { data: history } = await supabase
      .from("asset_history")
      .select("*")
      .eq("asset_id", asset.id)
      .order("opened_at", { ascending: false })
      .limit(100);
    return { asset, history: history ?? [] };
  });

// ---------- Claims ----------
export const listClaims = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ sla: z.enum(["all", "ontrack", "atrisk", "breached"]).optional().default("all") }).parse(i),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("claims")
      .select("*")
      .order("age_hours", { ascending: false })
      .limit(200);
    if (data.sla !== "all") q = q.eq("sla_status", data.sla);
    const { data: rows } = await q;
    return { claims: rows ?? [] };
  });

// ---------- Monitoring ----------
export const listMonitoring = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("monitoring_status")
      .select(
        "asset_id, asset_old_code, online, last_seen_at, uptime_7d, error_code, message, updated_at",
      )
      .order("online", { ascending: true })
      .limit(500);
    return { rows: data ?? [] };
  });

// ---------- Sync logs ----------
export const getSyncLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("sync_logs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(60);
    return { logs: data ?? [] };
  });

// ---------- Settings ----------
export const getAppSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("app_settings").select("key, value");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map: Record<string, any> = {};
    for (const r of data ?? []) map[r.key] = r.value;
    return { settings: map };
  });

export const listAirtableSlots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("airtable_connections")
      .select("*")
      .order("id", { ascending: true });
    return { slots: data ?? [] };
  });

// ---------- Schema change detection ----------
// Compares current Asset payload keys vs a saved snapshot to alert when upstream changes.
export const getSchemaStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: sample } = await context.supabase
      .from("assets")
      .select("payload, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const currentKeys = sample?.payload && typeof sample.payload === "object"
      ? Object.keys(sample.payload as Record<string, unknown>).sort()
      : [];

    const { data: snap } = await context.supabase
      .from("app_settings")
      .select("value, updated_at")
      .eq("key", "asset_schema_snapshot")
      .maybeSingle();
    const snapVal = (snap?.value ?? null) as { keys?: string[]; takenAt?: string } | null;
    const snapKeys = Array.isArray(snapVal?.keys) ? [...(snapVal!.keys as string[])].sort() : [];

    const added = currentKeys.filter((k) => !snapKeys.includes(k));
    const removed = snapKeys.filter((k) => !currentKeys.includes(k));

    return {
      currentKeys,
      snapshotKeys: snapKeys,
      added,
      removed,
      hasSnapshot: snapKeys.length > 0,
      snapshotAt: snapVal?.takenAt ?? snap?.updated_at ?? null,
      lastAssetAt: sample?.updated_at ?? null,
      hasData: currentKeys.length > 0,
    };
  });
