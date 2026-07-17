import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Helpers ----------
// Shape used by Search History / Breakdown / Monitoring UIs.
// Built from mssql_asset_history rows so the UI stays unchanged.
type HistoryShape = {
  id: string;
  asset_id: string | null;
  asset_old_code: string | null;
  ticket_code: string;
  type: "PM" | "Claim" | "Monitor" | "Other";
  title: string | null;
  status: string | null;
  opened_at: string | null;
  closed_at: string | null;
  sla_hours: number | null;
  payload: Record<string, string | number | boolean | null>;
};

type MssqlRow = {
  id: string;
  ref_number: string | null;
  old_code: string | null;
  category: string | null;
  status: string | null;
  project: string | null;
  media_type: string | null;
  bkk_upc: string | null;
  created_date: string | null;
  updated_date: string | null;
  inform_position: string | null;
  inform_detail: string | null;
  problem_category: string | null;
  problem_equipment: string | null;
  problem_detail: string | null;
  solution_category: string | null;
  solution_detail: string | null;
  response_time: number | null;
  resolve_time: number | null;
  total_turnaround_time: number | null;
  asset_status: string | null;
};

const MSSQL_HISTORY_COLS =
  "id, ref_number, old_code, category, status, project, media_type, bkk_upc, created_date, updated_date, inform_position, inform_detail, problem_category, problem_equipment, problem_detail, solution_category, solution_detail, response_time, resolve_time, total_turnaround_time, asset_status";


function typeFromCategory(cat: string | null): HistoryShape["type"] {
  const c = (cat ?? "").trim();
  if (c === "Claim") return "Claim";
  if (c.startsWith("PM")) return "PM";
  if (c === "Monitoring") return "Monitor";
  return "Other";
}

function toHistoryShape(h: MssqlRow, assetIdByCode: Map<string, string>): HistoryShape {
  const payload: Record<string, unknown> = {
    refNumber: h.ref_number,
    project: h.project,
    oldCode: h.old_code,
    mediaType: h.media_type,
    bkkUpc: h.bkk_upc,
    category: h.category,
    createdDate: h.created_date,
    updatedDate: h.updated_date,
    status: h.status,
    informPosition: h.inform_position,
    informDetail: h.inform_detail,
    problemCategory: h.problem_category,
    problemEquipment: h.problem_equipment,
    problemDetail: h.problem_detail,
    solutionCategory: h.solution_category,
    solutionDetail: h.solution_detail,
    responseTime: h.response_time,
    resolveTime: h.resolve_time,
    totalTurnaroundTime: h.total_turnaround_time,
    assetStatus: h.asset_status,
  };
  const type = typeFromCategory(h.category);
  const title =
    type === "Claim"
      ? (h.solution_detail || h.solution_category || h.problem_detail || "Claim")
      : type === "PM"
        ? "Preventive Maintenance"
        : "Monitoring Check";
  return {
    id: h.id,
    asset_id: h.old_code ? assetIdByCode.get(h.old_code) ?? null : null,
    asset_old_code: h.old_code,
    ticket_code: h.ref_number ?? "",
    type,
    title,
    status: h.status,
    opened_at: h.created_date,
    closed_at: h.updated_date,
    sla_hours: null,
    payload: payload as Record<string, string | number | boolean | null>,
  };
}


// ---------- Dashboard ----------
export const getDashboardOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    const [assetsRes, claimsRes, monitorRes, historyRes] = await Promise.all([
      supabase.from("assets").select("id, department, status", { count: "exact" }),
      supabase.from("claim_tickets").select("ref_number, sla_status, age_hours", { count: "exact" }),
      supabase.from("monitoring_status").select("online, error_code"),
      supabase
        .from("mssql_asset_history")
        .select("id, category, status, old_code, created_date, problem_detail, solution_detail")
        .order("created_date", { ascending: false })
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
      .from("mssql_asset_history")
      .select("category, created_date")
      .gte("created_date", new Date(now.getFullYear(), now.getMonth() - 4, 1).toISOString());
    for (const h of histAll ?? []) {
      if (!h.created_date) continue;
      const d = new Date(h.created_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = trendBuckets[key];
      if (!b) continue;
      const t = typeFromCategory(h.category);
      if (t === "PM") b.pm++;
      else if (t === "Claim") b.claim++;
      else if (t === "Monitor") b.monitor++;
    }
    const trendData = monthLabels.map((label, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (4 - i), 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = trendBuckets[key];
      return { month: label, ...b };
    });

    // stats — PM count this month (category LIKE 'PM%')
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const { count: pmThisMonth } = await supabase
      .from("mssql_asset_history")
      .select("id", { count: "exact", head: true })
      .like("category", "PM%")
      .gte("created_date", monthStart);

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
        id: h.id,
        type: typeFromCategory(h.category),
        status: h.status ?? "—",
        title: h.solution_detail ?? h.problem_detail ?? "",
        opened_at: h.created_date,
        asset_old_code: h.old_code,
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

    let history: HistoryShape[] = [];
    if (assets && assets.length) {
      const codes = assets.map((a) => a.old_code).filter(Boolean) as string[];
      const assetIdByCode = new Map(assets.map((a) => [a.old_code, a.id] as const));
      let q2 = supabase
        .from("mssql_asset_history")
        .select(MSSQL_HISTORY_COLS)
        .in("old_code", codes)
        .order("created_date", { ascending: false })
        .limit(200);
      if (data.tab === "PM") q2 = q2.like("category", "PM%");
      else if (data.tab === "Claim") q2 = q2.eq("category", "Claim");
      else if (data.tab === "Monitor") q2 = q2.eq("category", "Monitoring");
      const { data: h } = await q2;
      history = (h ?? []).map((r) => toHistoryShape(r as MssqlRow, assetIdByCode));
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
      departments: z.array(z.string()).optional(),
      region: z.string().optional(),
      mediaType: z.string().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const q = data.q.trim();
    let query = supabase
      .from("assets")
      .select("id, old_code, name, area, department, status, media_type, payload")
      .order("old_code", { ascending: true })
      .limit(data.limit);
    if (q) {
      query = query.or(`old_code.ilike.%${q}%,name.ilike.%${q}%,area.ilike.%${q}%`);
    }
    if (data.departments && data.departments.length) query = query.in("department", data.departments);
    else if (data.department) query = query.eq("department", data.department);
    if (data.region) query = query.eq("area", data.region);
    if (data.mediaType) query = query.eq("media_type", data.mediaType);
    const { data: rowsRaw, error } = await query;
    if (error) return { rows: [], error: error.message };
    return { rows: rowsRaw ?? [], error: null };
  });

// Global filter options across ALL assets (for pre-filter UI)
export const getFilterOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("assets")
      .select("department, area, media_type")
      .limit(10000);
    const depts = new Set<string>();
    const regions = new Set<string>();
    const mediaTypes = new Set<string>();
    for (const r of data ?? []) {
      if (r.department) depts.add(r.department);
      if (r.area) regions.add(r.area);
      if (r.media_type) mediaTypes.add(r.media_type);
    }
    return {
      departments: Array.from(depts).sort(),
      regions: Array.from(regions).sort(),
      mediaTypes: Array.from(mediaTypes).sort(),
    };
  });

// Fetch one asset + history (from MSSQL-sourced mssql_asset_history)
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
    if (!asset) return { asset: null, history: [] as HistoryShape[], synced: false, syncError: null };

    let q = supabase
      .from("mssql_asset_history")
      .select(MSSQL_HISTORY_COLS)
      .eq("old_code", data.oldCode)
      .order("created_date", { ascending: false })
      .limit(200);
    if (data.tab === "PM") q = q.like("category", "PM%");
    else if (data.tab === "Claim") q = q.eq("category", "Claim");
    else if (data.tab === "Monitor") q = q.eq("category", "Monitoring");
    const { data: history } = await q;
    const idMap = new Map([[asset.old_code, asset.id] as const]);
    return {
      asset,
      history: (history ?? []).map((r) => toHistoryShape(r as MssqlRow, idMap)),
      synced: false,
      syncError: null,
    };
  });

// Comparison: fetch up to 5 assets + history filtered by tab + date range + slicers.
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
    const { data: assets2 } = await supabase
      .from("assets")
      .select("id, old_code, name, department, area, status, media_type, last_pm_at, last_claim_at, last_monitor_ok_at, latitude, longitude, installed_at")
      .in("old_code", data.oldCodes);
    const finalAssets = assets2 ?? [];

    const assetIdByCode = new Map(finalAssets.map((a) => [a.old_code, a.id] as const));
    let history: HistoryShape[] = [];

    if (finalAssets.length) {
      const codes = finalAssets.map((a) => a.old_code).filter(Boolean) as string[];
      let q = supabase
        .from("mssql_asset_history")
        .select(MSSQL_HISTORY_COLS)
        .in("old_code", codes)
        .order("created_date", { ascending: false })
        .limit(2000);
      if (data.tab === "PM") q = q.like("category", "PM%");
      else if (data.tab === "Claim") q = q.eq("category", "Claim");
      else if (data.tab === "Monitor") q = q.eq("category", "Monitoring");
      if (data.from) q = q.gte("created_date", data.from);
      if (data.to) q = q.lte("created_date", data.to);
      const { data: h } = await q;
      history = (h ?? []).map((r) => toHistoryShape(r as MssqlRow, assetIdByCode));
    }

    // NOTE: Claim counts everywhere must match mssql_asset_history WHERE
    // category='Claim' (single source of truth across the system). We do NOT
    // merge open claim_tickets into any view, so Tab Claim / AssetHealth
    // calendar / bar chart all show the same number.


    // slicer filter (in-memory)
    const filtered = finalAssets.filter((a) => {
      if (data.department && (a.department ?? "") !== data.department) return false;
      if (data.region && (a.area ?? "") !== data.region) return false;
      if (data.mediaType && (a.media_type ?? "") !== data.mediaType) return false;
      return true;
    });

    const departments = Array.from(new Set(finalAssets.map((a) => a.department).filter(Boolean))) as string[];
    const regions = Array.from(new Set(finalAssets.map((a) => a.area).filter(Boolean))) as string[];
    const mediaTypes = Array.from(new Set(finalAssets.map((a) => a.media_type).filter(Boolean))) as string[];

    return {
      assets: filtered,
      history,
      slicers: { departments, regions, mediaTypes },
      syncErrors: {} as Record<string, string>,
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
    if (!asset) return { asset: null, history: [] as HistoryShape[] };
    const { data: history } = await supabase
      .from("mssql_asset_history")
      .select(MSSQL_HISTORY_COLS)
      .eq("old_code", data.oldCode)
      .order("created_date", { ascending: false })
      .limit(100);
    const idMap = new Map([[asset.old_code as string, asset.id as string] as const]);
    return {
      asset,
      history: (history ?? []).map((r) => toHistoryShape(r as MssqlRow, idMap)),
    };
  });

// ---------- Asset PM Schedules (from Modern Corp `Asset_PM_Schedule` table) ----------
export const getAssetsPmSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      oldCodes: z.array(z.string().min(1).max(100)).min(1).max(20),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("asset_pm_schedules")
      .select("id, project, asset_old_code, ref_number, schedule_date, status, inform_position, asset_status, payload, synced_at")
      .in("asset_old_code", data.oldCodes)
      .order("schedule_date", { ascending: false })
      .limit(2000);
    return { rows: rows ?? [] };
  });

// ---------- Claims ----------
export const listClaims = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ sla: z.enum(["all", "ontrack", "atrisk", "breached"]).optional().default("all") }).parse(i),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("claim_tickets")
      .select("*")
      .order("opened_at", { ascending: false })
      .limit(2000);
    if (data.sla !== "all") q = q.eq("sla_status", data.sla);
    const { data: rows } = await q;
    const tickets = rows ?? [];

    const codes = Array.from(
      new Set(tickets.map((c) => c.asset_old_code).filter(Boolean) as string[]),
    );
    const deptMap = new Map<string, string | null>();
    if (codes.length) {
      const { data: assets } = await context.supabase
        .from("assets")
        .select("old_code, department")
        .in("old_code", codes);
      for (const a of assets ?? []) deptMap.set(a.old_code, a.department ?? null);
    }
    const enriched = tickets.map((c) => {
      const p = (c.payload ?? {}) as Record<string, unknown>;
      const assetStatus = (p.assetStatus ?? p.AssetStatus ?? null) as string | null;
      const totalTimeRaw = (p.totalTime ?? p.TotalTime ?? null) as number | string | null;
      const totalTime = totalTimeRaw === null || totalTimeRaw === "" ? null : Number(totalTimeRaw);
      return {
        id: c.ref_number,
        ticket_code: c.ref_number,
        asset_old_code: c.asset_old_code,
        title: c.title ?? c.informed_detail ?? c.location ?? null,
        opened_at: c.opened_at,
        age_hours: c.age_hours,
        total_time: Number.isFinite(totalTime as number) ? (totalTime as number) : null,
        sla_status: c.sla_status,
        severity: c.severity,
        department: c.asset_old_code ? deptMap.get(c.asset_old_code) ?? null : null,
        status: c.status,
        asset_status: assetStatus,
        payload: c.payload,
      };
    });
    const departments = Array.from(
      new Set(enriched.map((c) => c.department).filter(Boolean) as string[]),
    ).sort();
    const oldCodes = Array.from(
      new Set(enriched.map((c) => c.asset_old_code).filter(Boolean) as string[]),
    ).sort();
    return { claims: enriched, departments, oldCodes };
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

// ---------- Database schema info (Settings → Database Schema tab) ----------
export type SchemaTableInfo = {
  name: string;
  kind: string;
  primary_key: string[];
  foreign_keys: Array<{ column: string; references_table: string; references_column: string }>;
  columns: Array<{ name: string; type: string; nullable: boolean }>;
  column_count: number;
  est_rows: number;
};

export const getDatabaseSchema = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as unknown as {
      rpc: (name: string) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await sb.rpc("get_public_schema_info");
    if (error) throw new Error(error.message);
    const payload = (data ?? {}) as { tables?: SchemaTableInfo[] };
    return { tables: payload.tables ?? [], fetchedAt: new Date().toISOString() };
  });

// ---------- Asset Profile (for Profile tab in Search) ----------
export const getAssetProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ oldCodes: z.array(z.string().min(1).max(100)).min(1).max(5) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: assets }, { data: claims }] = await Promise.all([
      supabase
        .from("assets")
        .select("id, old_code, name, department, area, status, latitude, longitude, payload")
        .in("old_code", data.oldCodes),
      supabase
        .from("claim_tickets")
        .select("asset_old_code, severity, sla_status, title, opened_at, payload")
        .in("asset_old_code", data.oldCodes)
        .order("opened_at", { ascending: false }),
    ]);
    const list = assets ?? [];
    const codes = list.map((a) => a.old_code).filter(Boolean) as string[];
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const histRes = codes.length
      ? await supabase
          .from("mssql_asset_history")
          .select("old_code, category, created_date, updated_date")
          .in("old_code", codes)
          .gte("created_date", since.toISOString())
      : { data: [] as Array<{ old_code: string | null; category: string | null; created_date: string | null; updated_date: string | null }> };
    const hist = histRes.data ?? [];

    const th = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
    const months: { key: string; label: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push({ key, label: `${th[d.getMonth()]} ${String(d.getFullYear() + 543).slice(-2)}` });
    }

    const claimByCode = new Map<string, { asset_old_code: string | null; severity: string | null; sla_status: string | null; title: string | null; opened_at: string | null; payload: unknown }>();
    for (const c of (claims ?? [])) {
      if (c.asset_old_code && !claimByCode.has(c.asset_old_code)) claimByCode.set(c.asset_old_code, c);
    }

    const profiles = list.map((a) => {
      const claim = claimByCode.get(a.old_code) ?? null;
      let status: string;
      let statusTone: "ok" | "warning" | "danger";
      if (!claim) {
        status = "เปิดใช้งานปกติ";
        statusTone = "ok";
      } else {
        const sev = (claim.severity ?? "").toString().trim();
        status = sev || "อยู่ระหว่างการปรับปรุง";
        statusTone = /finish|approved|closed|done|ok/i.test(sev) ? "ok" : "warning";
      }
      let lat: number | null = a.latitude != null ? Number(a.latitude) : null;
      let lng: number | null = a.longitude != null ? Number(a.longitude) : null;
      if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
        const p = (a.payload ?? {}) as Record<string, unknown>;
        const ll = (p.latitudeLongitude ?? p.LatitudeLongitude ?? p.latLng ?? p.LatLng) as string | undefined;
        if (typeof ll === "string" && ll.includes(",")) {
          const [la, ln] = ll.split(",").map((s) => Number(s.trim()));
          if (Number.isFinite(la) && Number.isFinite(ln)) { lat = la; lng = ln; }
        }
        if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
          const la = Number((p.latitude ?? p.Latitude ?? p.lat ?? p.Lat) as number | string | undefined);
          const ln = Number((p.longitude ?? p.Longitude ?? p.lng ?? p.Lng ?? p.lon ?? p.Lon) as number | string | undefined);
          if (Number.isFinite(la) && Number.isFinite(ln)) { lat = la; lng = ln; }
        }
        if (lat != null && Number.isNaN(lat)) lat = null;
        if (lng != null && Number.isNaN(lng)) lng = null;
      }
      const counts = { PM: Array(12).fill(0) as number[], Claim: Array(12).fill(0) as number[], Monitor: Array(12).fill(0) as number[] };
      for (const h of hist) {
        if (h.old_code !== a.old_code) continue;
        const t = typeFromCategory(h.category);
        const d = t === "Claim" ? h.created_date : (h.updated_date ?? h.created_date);
        if (!d) continue;
        const key = String(d).slice(0, 7);
        const idx = months.findIndex((m) => m.key === key);
        if (idx >= 0 && (t === "PM" || t === "Claim" || t === "Monitor")) counts[t][idx]++;
      }
      return {
        asset: a,
        status,
        statusTone,
        claim: claim ? { title: claim.title, severity: claim.severity, sla_status: claim.sla_status, opened_at: claim.opened_at } : null,
        lat, lng,
        monthly: months.map((m, i) => ({ month: m.label, PM: counts.PM[i], Claim: counts.Claim[i], Monitor: counts.Monitor[i] })),
      };
    });
    return { profiles };
  });

// ---------- Diagram Mappings (Breakdown classifier) ----------
export const listDiagramMappings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("diagram_mappings")
      .select("id, category, label, icon, keywords, sort_order, enabled, updated_at")
      .order("sort_order", { ascending: true })
      .order("category", { ascending: true });
    return { mappings: data ?? [] };
  });
