import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { departmentsForProjects, projectForDepartment } from "@/lib/project-department-map";

// Mirror of pm-insights.functions.ts but for Monitoring (category = Monitoring)
// Pulls from mssql_asset_history (Monitoring + Claim) instead of the PM MVs.

const filtersSchema = z.object({
  departments: z.array(z.string()).optional().default([]),
  zones: z.array(z.string()).optional().default([]),
  projects: z.array(z.string()).optional().default([]),
  mediaTypes: z.array(z.string()).optional().default([]),
  fromDate: z.string().optional().nullable(),
  toDate: z.string().optional().nullable(),
  assetCode: z.string().optional().nullable(),
});

export type MonitoringInsightsFilters = z.infer<typeof filtersSchema>;

const BUCKETS: { key: string; min: number; max: number }[] = [
  { key: "1-3", min: 1, max: 3 },
  { key: "4-7", min: 4, max: 7 },
  { key: "8-15", min: 8, max: 15 },
  { key: "16-30", min: 16, max: 30 },
  { key: "31-60", min: 31, max: 60 },
  { key: "61-90", min: 61, max: 90 },
];
function bucketOf(d: number): string | null {
  for (const b of BUCKETS) if (d >= b.min && d <= b.max) return b.key;
  return null;
}

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 500; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const res = await build(from, to);
    if (res.error) throw new Error(res.error.message);
    const rows = (res.data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

// Keyset paginate mssql_asset_history by created_date+id (avoids OFFSET scans
// that hit Postgres statement_timeout on the huge table).
async function fetchHistoryByCreatedDate<T extends { id: string; created_date: string | null }>(
  category: "Monitoring" | "Claim",
  options: { fromMs?: number; toMs?: number; oldCodes?: string[] } = {},
  pageSize = 10000,
): Promise<T[]> {
  const codes = options.oldCodes?.filter(Boolean);
  if (codes && codes.length === 0) return [];

  const out: T[] = [];
  let lastCreatedDate: string | null = null;

  for (let page = 0; page < 500; page++) {
    let q = supabaseAdmin
      .from("mssql_asset_history")
      .select(
        "id, old_code, category, created_date, updated_date, status, asset_status, inform_detail, problem_category, problem_detail, problem_equipment, solution_category, solution_detail, project, bkk_upc, media_type",
      )
      .eq("category", category)
      .not("created_date", "is", null)
      .order("created_date", { ascending: true })
      .order("id", { ascending: true })
      .limit(pageSize);

    if (Number.isFinite(options.fromMs)) q = q.gte("created_date", new Date(options.fromMs!).toISOString());
    if (Number.isFinite(options.toMs)) q = q.lte("created_date", new Date(options.toMs!).toISOString());
    if (codes) q = q.in("old_code", codes);
    if (lastCreatedDate) q = q.gt("created_date", lastCreatedDate);

    const res = await q;
    if (res.error) throw new Error(res.error.message);
    const rows = ((res.data as unknown) as T[] | null) ?? [];
    if (rows.length === 0) break;
    out.push(...rows);
    const last = rows[rows.length - 1];
    lastCreatedDate = last.created_date;
    if (rows.length < pageSize) break;
  }
  return out;
}

async function fetchHistoryForScope<T extends HistRow>(
  category: "Monitoring" | "Claim",
  options: { fromMs?: number; toMs?: number; oldCodes?: string[] },
): Promise<T[]> {
  const codes = options.oldCodes;
  if (!codes || codes.length <= 200) return fetchHistoryByCreatedDate<T>(category, options);
  const out: T[] = [];
  for (let i = 0; i < codes.length; i += 200) {
    out.push(...(await fetchHistoryByCreatedDate<T>(category, { ...options, oldCodes: codes.slice(i, i + 200) })));
  }
  return out;
}

type HistRow = {
  id: string;
  old_code: string | null;
  category: "Monitoring" | "Claim" | string | null;
  created_date: string | null;
  updated_date: string | null;
  status: string | null;
  asset_status: string | null;
  inform_detail: string | null;
  problem_category: string | null;
  problem_detail: string | null;
  problem_equipment: string | null;
  solution_category: string | null;
  solution_detail: string | null;
  project: string | null;
  bkk_upc: string | null;
  media_type: string | null;
};

type AssetLite = {
  old_code: string;
  name: string | null;
  department: string | null;
  area: string | null;
  asset_media_type: string | null;
  zone: string | null;
};

function pickDate(h: HistRow): string | null {
  if (h.category === "Monitoring") return h.updated_date ?? h.created_date ?? null;
  return h.created_date ?? h.updated_date ?? null;
}

export const getMonitoringInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => filtersSchema.parse(i ?? {}))
  .handler(async ({ data: f }) => {
    // 1. Assets — needed for in-scope filtering and decoration
    const assetsRaw = await fetchAll<{
      old_code: string;
      name: string | null;
      department: string | null;
      area: string | null;
      payload: Record<string, unknown> | null;
    }>((from, to) =>
      supabaseAdmin.from("assets").select("old_code, name, department, area, payload").range(from, to),
    );

    const activeCodes = new Set<string>();
    for (const r of assetsRaw) {
      const p = r.payload as Record<string, unknown> | null;
      const del = p?.IsDeleted;
      if (del !== true && del !== "true") activeCodes.add(r.old_code);
    }
    const assetMap = new Map<string, AssetLite>();
    for (const r of assetsRaw) {
      if (!activeCodes.has(r.old_code)) continue;
      if (assetMap.has(r.old_code)) continue;
      const p = (r.payload ?? {}) as Record<string, unknown>;
      assetMap.set(r.old_code, {
        old_code: r.old_code,
        name: r.name,
        department: r.department,
        area: r.area,
        asset_media_type: typeof p.MediaType === "string" ? (p.MediaType as string) : null,
        zone:
          typeof p.BKKUPC === "string"
            ? (p.BKKUPC as string)
            : typeof p.BkkUpc === "string"
              ? (p.BkkUpc as string)
              : null,
      });
    }
    const deletedSet = new Set<string>();
    for (const r of assetsRaw) if (!activeCodes.has(r.old_code)) deletedSet.add(r.old_code);

    // 2. Filter scaffolding
    const fromTs = f.fromDate ? new Date(f.fromDate).getTime() : -Infinity;
    const toTs = f.toDate ? new Date(f.toDate).getTime() + 86_400_000 : Infinity;
    const depSet = new Set(f.departments);
    const zoneSet = new Set(f.zones);
    const projSet = new Set(f.projects);
    const projDeptSet = departmentsForProjects(f.projects);
    const mtSet = new Set(f.mediaTypes);
    const assetCodeQ = (f.assetCode ?? "").trim().toLowerCase();

    function matchProject(project: string, dept: string): boolean {
      if (!projSet.size) return true;
      if (projSet.has(project)) return true;
      if (dept && projDeptSet.has(dept)) return true;
      return false;
    }
    function inScopeHist(h: HistRow): boolean {
      if (h.old_code && deletedSet.has(h.old_code)) return false;
      const a = h.old_code ? assetMap.get(h.old_code) : undefined;
      const dept = a?.department ?? "";
      if (depSet.size && !depSet.has(dept)) return false;
      const zone = h.bkk_upc ?? a?.zone ?? "";
      if (zoneSet.size && !zoneSet.has(zone)) return false;
      if (!matchProject(h.project ?? "", dept)) return false;
      const mt = h.media_type || a?.asset_media_type || "";
      if (mtSet.size && !mtSet.has(mt)) return false;
      if (assetCodeQ && (h.old_code ?? "").toLowerCase() !== assetCodeQ) return false;
      return true;
    }
    function inFilterHist(h: HistRow): boolean {
      if (!inScopeHist(h)) return false;
      const src = pickDate(h);
      const ts = src ? new Date(src).getTime() : NaN;
      if (Number.isFinite(ts) && (ts < fromTs || ts > toTs)) return false;
      return true;
    }

    // 3. Restrict history to in-scope assets when small enough — keeps query fast
    const inScopeAssetCodes: string[] = [];
    for (const a of assetMap.values()) {
      if (depSet.size && !depSet.has(a.department ?? "")) continue;
      if (projSet.size && !(a.department && projDeptSet.has(a.department))) continue;
      if (mtSet.size && !mtSet.has(a.asset_media_type ?? "")) continue;
      if (zoneSet.size && !zoneSet.has(a.zone ?? "")) continue;
      if (assetCodeQ && a.old_code.toLowerCase() !== assetCodeQ) continue;
      inScopeAssetCodes.push(a.old_code);
    }
    const historyCodes =
      assetCodeQ || inScopeAssetCodes.length <= 1500 ? inScopeAssetCodes : undefined;

    // 4. Load Monitoring + Claim history
    const fromMs = Number.isFinite(fromTs) ? fromTs : undefined;
    const toMs = Number.isFinite(toTs) ? toTs : undefined;
    const [monRows, claimRows] = await Promise.all([
      fetchHistoryForScope<HistRow>("Monitoring", { fromMs, toMs, oldCodes: historyCodes }),
      fetchHistoryForScope<HistRow>("Claim", { fromMs, toMs, oldCodes: historyCodes }),
    ]);
    // Stamp the discriminating "type" — page UI follows pm-insights convention
    for (const r of monRows) r.category = "Monitoring";
    for (const r of claimRows) r.category = "Claim";
    const hist = [...monRows, ...claimRows];

    // 5. Filter option universes
    const allDepts = new Set<string>();
    const allZones = new Set<string>();
    const allProjects = new Set<string>();
    const allMediaTypes = new Set<string>();
    for (const a of assetMap.values()) {
      if (a.department) allDepts.add(a.department);
      if (a.asset_media_type) allMediaTypes.add(a.asset_media_type);
      if (a.zone) allZones.add(a.zone);
    }
    for (const h of hist) {
      if (h.bkk_upc) allZones.add(h.bkk_upc);
      if (h.project) allProjects.add(h.project);
      if (h.media_type) allMediaTypes.add(h.media_type);
    }

    const filteredHist = hist.filter(inFilterHist);

    // 6. KPIs — ticket-level Monitoring counts (mirrors PM Insights KPI structure)
    let monTickets = 0,
      monPass = 0,
      monFail = 0,
      monSkip = 0,
      monPending = 0;
    const monByAssetDates = new Map<string, number[]>();
    for (const h of filteredHist) {
      if (h.category !== "Monitoring") continue;
      monTickets++;
      const s = (h.asset_status ?? "").toLowerCase();
      if (s === "pass") monPass++;
      else if (s === "fail") monFail++;
      else if (s.includes("skip")) monSkip++;
      else monPending++;
      const code = h.old_code;
      if (code) {
        const src = pickDate(h);
        const ts = src ? new Date(src).getTime() : NaN;
        if (Number.isFinite(ts)) {
          const arr = monByAssetDates.get(code) ?? [];
          arr.push(ts);
          monByAssetDates.set(code, arr);
        }
      }
    }
    let gapSum = 0,
      gapN = 0;
    for (const arr of monByAssetDates.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => a - b);
      for (let i = 1; i < arr.length; i++) {
        gapSum += (arr[i] - arr[i - 1]) / 86_400_000;
        gapN++;
      }
    }
    const monAvgGapDays = gapN > 0 ? Math.round((gapSum / gapN) * 10) / 10 : null;

    const kpi = {
      monTickets,
      monPass,
      monFail,
      monSkip,
      monPending,
      monAvgGapDays,
    };

    // 7. Monitor→Claim pairs (build in-memory; same shape as pm pairs)
    type Pair = {
      assetCode: string;
      department: string;
      mediaType: string;
      zone: string;
      project: string;
      pmDate: string;
      claimDate: string;
      pmTicket: string;
      claimTicket: string;
      days: number;
      problemCategory: string;
      problemDetail: string;
      problemEquipment: string;
      solutionCategory: string;
      solutionDetail: string;
      status: string;
      assetStatus: string;
    };
    const monByAsset = new Map<string, HistRow[]>();
    const claimByAsset = new Map<string, HistRow[]>();
    for (const h of filteredHist) {
      if (!h.old_code) continue;
      const m = h.category === "Monitoring" ? monByAsset : h.category === "Claim" ? claimByAsset : null;
      if (!m) continue;
      const arr = m.get(h.old_code) ?? [];
      arr.push(h);
      m.set(h.old_code, arr);
    }
    const pairs: Pair[] = [];
    for (const [code, mons] of monByAsset) {
      const claims = (claimByAsset.get(code) ?? [])
        .map((c) => ({ row: c, ts: new Date(pickDate(c) ?? 0).getTime() }))
        .filter((x) => Number.isFinite(x.ts))
        .sort((a, b) => a.ts - b.ts);
      if (claims.length === 0) continue;
      const a = assetMap.get(code);
      for (const m of mons) {
        if ((m.asset_status ?? "").toLowerCase() !== "pass") continue;
        const mTs = new Date(m.updated_date ?? m.created_date ?? 0).getTime();
        if (!Number.isFinite(mTs)) continue;
        const next = claims.find((c) => c.ts >= mTs);
        if (!next) continue;
        const days = Math.floor((next.ts - mTs) / 86_400_000);
        if (days < 1 || days > 90) continue;
        const c = next.row;
        pairs.push({
          assetCode: code,
          department: a?.department ?? "",
          mediaType: m.media_type || a?.asset_media_type || "(ไม่ระบุ)",
          zone: m.bkk_upc ?? a?.zone ?? "",
          project: m.project ?? "",
          pmDate: (m.updated_date ?? m.created_date ?? "").slice(0, 10),
          claimDate: (c.created_date ?? "").slice(0, 10),
          pmTicket: "",
          claimTicket: "",
          days,
          problemCategory: c.problem_category || "(ไม่ระบุ)",
          problemDetail: c.problem_detail || "(ไม่ระบุ)",
          problemEquipment: c.problem_equipment || "(ไม่ระบุ)",
          solutionCategory: c.solution_category || "(ไม่ระบุ)",
          solutionDetail: c.solution_detail || "(ไม่ระบุ)",
          status: c.status ?? "",
          assetStatus: m.asset_status ?? "",
        });
      }
    }

    // 8. Monthly Monitoring vs Claim (current year, ignores date filter; mirrors pm-insights)
    const year = new Date().getFullYear();
    type MonthTicket = {
      ticket: string;
      assetCode: string;
      date: string;
      status: string;
      category: string;
      department: string;
    };
    const monthlyMap = new Map<number, { pm: number; claim: number }>();
    const monthlyDetailsMap = new Map<number, { pm: MonthTicket[]; claim: MonthTicket[] }>();
    for (let m = 0; m < 12; m++) {
      monthlyMap.set(m, { pm: 0, claim: 0 });
      monthlyDetailsMap.set(m, { pm: [], claim: [] });
    }
    for (const h of hist) {
      if (!inScopeHist(h)) continue;
      const src = pickDate(h);
      if (!src) continue;
      const d = new Date(src);
      if (!Number.isFinite(d.getTime()) || d.getFullYear() !== year) continue;
      const mi = d.getMonth();
      const row = monthlyMap.get(mi)!;
      const det = monthlyDetailsMap.get(mi)!;
      const item: MonthTicket = {
        ticket: "",
        assetCode: h.old_code ?? "",
        date: src.slice(0, 10),
        status: h.status ?? "",
        category: (h.category as string) ?? "",
        department: (h.old_code ? assetMap.get(h.old_code)?.department : "") ?? "",
      };
      if (h.category === "Monitoring") {
        row.pm++;
        det.pm.push(item);
      } else if (h.category === "Claim") {
        row.claim++;
        det.claim.push(item);
      }
    }
    const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthly = MONTH_LABELS.map((label, i) => ({
      month: label,
      pm: monthlyMap.get(i)!.pm,
      claim: monthlyMap.get(i)!.claim,
    }));
    const monthlyDetails = MONTH_LABELS.map((label, i) => ({
      month: label,
      pm: monthlyDetailsMap.get(i)!.pm,
      claim: monthlyDetailsMap.get(i)!.claim,
    }));

    // 9. Aging
    const agingMap = new Map<string, number>();
    for (const b of BUCKETS) agingMap.set(b.key, 0);
    for (const p of pairs) {
      const k = bucketOf(p.days);
      if (k) agingMap.set(k, (agingMap.get(k) ?? 0) + 1);
    }
    const aging = BUCKETS.map((b) => ({ bucket: b.key, count: agingMap.get(b.key) ?? 0 }));

    function topN(arr: string[], n: number) {
      const m = new Map<string, number>();
      for (const v of arr) m.set(v, (m.get(v) ?? 0) + 1);
      return Array.from(m.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, n);
    }
    const earlyFails = pairs.filter((p) => p.days <= 30);
    const donuts = {
      problemCategory: topN(earlyFails.map((p) => p.problemCategory), 8),
      problemDetail: topN(earlyFails.map((p) => p.problemDetail), 8),
      problemEquipment: topN(earlyFails.map((p) => p.problemEquipment), 8),
      solutionCategory: topN(earlyFails.map((p) => p.solutionCategory), 8),
      solutionDetail: topN(earlyFails.map((p) => p.solutionDetail), 8),
    };

    pairs.sort((a, b) => a.days - b.days);

    // 10. All Monitoring rows for show/hide table
    type MonRow = {
      ticket: string;
      assetCode: string;
      assetName: string;
      project: string;
      zone: string;
      mediaType: string;
      department: string;
      category: string;
      problemCategory: string;
      problemDetail: string;
      createdDate: string;
      updatedDate: string;
      eventDate: string;
      ticketStatus: string;
      assetStatus: string;
      assetActive: "Active" | "Deleted";
    };
    const monRowsOut: MonRow[] = [];
    for (const h of filteredHist) {
      if (h.category !== "Monitoring") continue;
      const a = h.old_code ? assetMap.get(h.old_code) : undefined;
      monRowsOut.push({
        ticket: "",
        assetCode: h.old_code ?? "",
        assetName: a?.name ?? "",
        project: h.project ?? "",
        zone: h.bkk_upc ?? a?.zone ?? "",
        mediaType: h.media_type || a?.asset_media_type || "",
        department: a?.department ?? "",
        category: (h.category as string) ?? "",
        problemCategory: h.problem_category ?? "",
        problemDetail: h.problem_detail ?? "",
        createdDate: (h.created_date ?? "").slice(0, 19).replace("T", " "),
        updatedDate: (h.updated_date ?? "").slice(0, 19).replace("T", " "),
        eventDate: ("").slice(0, 19).replace("T", " "),
        ticketStatus: h.status ?? "",
        assetStatus: h.asset_status ?? "",
        assetActive: h.old_code && deletedSet.has(h.old_code) ? "Deleted" : "Active",
      });
    }
    monRowsOut.sort((a, b) => (b.createdDate || "").localeCompare(a.createdDate || ""));
    const monRowsTotal = monRowsOut.length;

    // 11. Calendar — green = Pass, red = Fail (Monitoring asset_status)
    type DayBuckets = { pass: Set<string>; fail: Set<string> };
    const calMap = new Map<string, DayBuckets>();
    for (const h of filteredHist) {
      if (h.category !== "Monitoring") continue;
      const s = (h.asset_status ?? "").toLowerCase();
      if (s !== "pass" && s !== "fail") continue;
      const src = pickDate(h);
      const date = (src ?? "").slice(0, 10);
      if (!date) continue;
      let v = calMap.get(date);
      if (!v) {
        v = { pass: new Set(), fail: new Set() };
        calMap.set(date, v);
      }
      const key = h.old_code || "";
      if (s === "pass") v.pass.add(key);
      else v.fail.add(key);
    }
    const calendarDays = Array.from(calMap.entries())
      .map(([date, v]) => ({
        date,
        pass: v.pass.size,
        fail: v.fail.size,
        passCodes: Array.from(v.pass).slice(0, 30),
        failCodes: Array.from(v.fail).slice(0, 30),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      kpi,
      monthly,
      monthlyDetails,
      aging,
      donuts,
      pairs: pairs.slice(0, 2000),
      monRows: monRowsOut.slice(0, 10000),
      monRowsTotal,
      calendarDays,
      filters: {
        departments: Array.from(allDepts).sort(),
        zones: Array.from(allZones).sort(),
        projects: Array.from(allProjects).sort(),
        mediaTypes: Array.from(allMediaTypes).sort(),
      },
    };
  });

// Filter options endpoint — mirrors getPmInsightsFilterOptions
export const getMonitoringInsightsFilterOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    type AssetLiteP = { old_code: string; department: string | null; payload: Record<string, unknown> | null };
    const assets = await fetchAll<AssetLiteP>((from, to) =>
      supabaseAdmin.from("assets").select("old_code, department, payload").range(from, to),
    );
    const deps = new Set<string>();
    const zones = new Set<string>();
    const projects = new Set<string>();
    const mediaTypes = new Set<string>();
    const assetMeta: Array<{
      code: string;
      department: string | null;
      project: string | null;
      mediaType: string | null;
      zones: string[];
      projects: string[];
    }> = [];

    const seen = new Set<string>();
    for (const a of assets) {
      const p = (a.payload ?? {}) as Record<string, unknown>;
      const del = p?.IsDeleted;
      if (del === true || del === "true") continue;
      if (seen.has(a.old_code)) continue;
      seen.add(a.old_code);

      if (a.department) deps.add(a.department);
      const mt = typeof p?.MediaType === "string" ? (p.MediaType as string) : null;
      if (mt) mediaTypes.add(mt);
      const zoneRaw =
        typeof p?.BKKUPC === "string"
          ? (p.BKKUPC as string)
          : typeof p?.BkkUpc === "string"
            ? (p.BkkUpc as string)
            : null;
      if (zoneRaw) zones.add(zoneRaw);
      const projFromDept = projectForDepartment(a.department);
      if (projFromDept) projects.add(projFromDept);

      assetMeta.push({
        code: a.old_code,
        department: a.department,
        project: projFromDept,
        mediaType: mt,
        zones: zoneRaw ? [zoneRaw] : [],
        projects: projFromDept ? [projFromDept] : [],
      });
    }
    assetMeta.sort((a, b) => a.code.localeCompare(b.code));
    return {
      departments: Array.from(deps).sort(),
      zones: Array.from(zones).sort(),
      projects: Array.from(projects).sort(),
      mediaTypes: Array.from(mediaTypes).sort(),
      assetCodes: assetMeta.map((a) => a.code),
      assetMeta,
    };
  });
