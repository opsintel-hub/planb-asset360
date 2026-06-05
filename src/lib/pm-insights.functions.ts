import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { departmentsForProjects } from "@/lib/project-department-map";

const filtersSchema = z.object({
  departments: z.array(z.string()).optional().default([]),
  zones: z.array(z.string()).optional().default([]),
  projects: z.array(z.string()).optional().default([]),
  mediaTypes: z.array(z.string()).optional().default([]),
  // "" | "all" → ทั้ง PM (Media) + PM (non Media); "media" → PM (Media) เท่านั้น; "non-media" → PM (non Media) เท่านั้น
  pmCategory: z.enum(["all", "media", "non-media"]).optional().default("all"),
  fromDate: z.string().optional().nullable(),
  toDate: z.string().optional().nullable(),
  assetCode: z.string().optional().nullable(),
});

export type PmInsightsFilters = z.infer<typeof filtersSchema>;

const BUCKETS: { key: string; min: number; max: number }[] = [
  { key: "1-3", min: 1, max: 3 },
  { key: "4-7", min: 4, max: 7 },
  { key: "8-15", min: 8, max: 15 },
  { key: "16-30", min: 16, max: 30 },
  { key: "31-60", min: 31, max: 60 },
  { key: "61-90", min: 61, max: 90 },
  { key: ">90", min: 91, max: 9e9 },
];

function bucketOf(d: number): string {
  for (const b of BUCKETS) if (d >= b.min && d <= b.max) return b.key;
  return ">90";
}

// Normalized internal record — fields are lowercase regardless of source casing.
type Hist = {
  asset_old_code: string | null;
  category: string;       // "PM (Media)" | "PM (non Media)" | "Claim"
  type: "PM" | "Claim";   // simplified bucket
  createdDate: string;    // ISO
  updatedDate: string;    // ISO or ""
  project: string;
  mediaType: string;
  bkkUpc: string;
  assetStatus: string;
  status: string;
  problemCategory: string;
  problemDetail: string;
  problemEquipment: string;
  solutionCategory: string;
  solutionDetail: string;
  totalTurnaroundTime: number;
  ticket_code: string;
};

type Asset = { old_code: string; department: string | null; payload?: Record<string, unknown> | null; mediaType?: string };

function asPayload(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function pickStr(p: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = p?.[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
}
function pickNum(p: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = p?.[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v && !Number.isNaN(Number(v))) return Number(v);
  }
  return 0;
}

export const getPmInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => filtersSchema.parse(i ?? {}))
  .handler(async ({ data: f }) => {
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

    const assetsAll = await fetchAll<Asset>((from, to) =>
      supabaseAdmin.from("assets").select("old_code, department, payload").range(from, to),
    );
    const assetMap = new Map<string, Asset>();
    for (const a of assetsAll) {
      a.mediaType = pickStr(asPayload(a.payload), "MediaType");
      assetMap.set(a.old_code, a);
    }

    // Pull only PM/Claim categories from mssql_asset_history (skip Monitoring/PM Schedule)
    type RawHist = {
      asset_old_code: string | null;
      action_date: string | null;
      status: string | null;
      project: string | null;
      payload: Record<string, unknown> | null;
    };
    const raw = await fetchAll<RawHist>((from, to) =>
      supabaseAdmin
        .from("mssql_asset_history")
        .select("asset_old_code, action_date, status, project, payload")
        .in("payload->>Category", ["PM (Media)", "PM (non Media)", "Claim"])
        .range(from, to),
    );

    const allHist: Hist[] = [];
    for (const r of raw) {
      const p = asPayload(r.payload);
      const category = pickStr(p, "Category");
      const type: "PM" | "Claim" = category === "Claim" ? "Claim" : "PM";
      const createdRaw = pickStr(p, "CreatedDate") || r.action_date || "";
      allHist.push({
        asset_old_code: r.asset_old_code,
        category,
        type,
        createdDate: createdRaw,
        updatedDate: pickStr(p, "UpdatedDate"),
        project: pickStr(p, "Project") || r.project || "",
        mediaType: pickStr(p, "MediaType"),
        bkkUpc: pickStr(p, "BKKUPC"),
        assetStatus: pickStr(p, "AssetStatus"),
        status: pickStr(p, "Status") || r.status || "",
        problemCategory: pickStr(p, "ProblemCategory"),
        problemDetail: pickStr(p, "ProblemDetail"),
        problemEquipment: pickStr(p, "ProblemEquipment"),
        solutionCategory: pickStr(p, "SolutionCategory"),
        solutionDetail: pickStr(p, "SolutionDetail"),
        totalTurnaroundTime: pickNum(p, "TotalTurnaroundTime"),
        ticket_code: "",
      });
    }

    // ---- Filter helpers ----
    const fromTs = f.fromDate ? new Date(f.fromDate).getTime() : -Infinity;
    const toTs = f.toDate ? new Date(f.toDate).getTime() + 86400_000 : Infinity;
    const depSet = new Set(f.departments);
    const zoneSet = new Set(f.zones);
    const projSet = new Set(f.projects);
    const projDeptSet = departmentsForProjects(f.projects);
    const mtSet = new Set(f.mediaTypes);
    const assetCodeQ = (f.assetCode ?? "").trim().toLowerCase();

    function matchPmCategory(h: Hist): boolean {
      if (h.type !== "PM") return true; // Claim always passes the PM-category filter
      if (f.pmCategory === "media") return h.category === "PM (Media)";
      if (f.pmCategory === "non-media") return h.category === "PM (non Media)";
      return true;
    }

    function matchProject(h: Hist, asset: Asset | undefined): boolean {
      if (!projSet.size) return true;
      if (projSet.has(h.project)) return true;
      if (asset?.department && projDeptSet.has(asset.department)) return true;
      return false;
    }

    function inScopeFilter(h: Hist): boolean {
      const code = h.asset_old_code ?? "";
      const asset = assetMap.get(code);
      const dept = asset?.department ?? "";
      if (depSet.size && !depSet.has(dept)) return false;
      if (zoneSet.size && !zoneSet.has(h.bkkUpc)) return false;
      if (!matchProject(h, asset)) return false;
      // Prefer MediaType from history payload (more reliable per-ticket); fall back to asset
      const mt = h.mediaType || asset?.mediaType || "";
      if (mtSet.size && !mtSet.has(mt)) return false;
      if (!matchPmCategory(h)) return false;
      if (assetCodeQ && code.toLowerCase() !== assetCodeQ) return false;
      return true;
    }
    function inFilter(h: Hist): boolean {
      if (!inScopeFilter(h)) return false;
      const ts = new Date(h.createdDate).getTime();
      if (Number.isFinite(ts) && (ts < fromTs || ts > toTs)) return false;
      return true;
    }

    // For filter dropdowns
    const allDepts = new Set<string>();
    const allZones = new Set<string>();
    const allProjects = new Set<string>();
    const allMediaTypes = new Set<string>();
    for (const a of assetMap.values()) {
      if (a.department) allDepts.add(a.department);
      if (a.mediaType) allMediaTypes.add(a.mediaType);
    }
    for (const h of allHist) {
      if (h.bkkUpc) allZones.add(h.bkkUpc);
      if (h.project) allProjects.add(h.project);
      if (h.mediaType) allMediaTypes.add(h.mediaType);
    }

    const filtered: Hist[] = allHist.filter(inFilter);

    // ---- KPIs (4 cards) ----
    const pmAllAssets = new Set<string>();
    const pmMediaAssets = new Set<string>();
    const pmNonMediaAssets = new Set<string>();
    for (const h of filtered) {
      if (h.type !== "PM" || !h.asset_old_code) continue;
      pmAllAssets.add(h.asset_old_code);
      if (h.category === "PM (Media)") pmMediaAssets.add(h.asset_old_code);
      if (h.category === "PM (non Media)") pmNonMediaAssets.add(h.asset_old_code);
    }
    // Asset count uses the same scope filters (no date)
    let assetCount = 0;
    for (const a of assetMap.values()) {
      if (depSet.size && !depSet.has(a.department ?? "")) continue;
      if (projSet.size && !(a.department && projDeptSet.has(a.department))) continue;
      if (mtSet.size && !mtSet.has(a.mediaType ?? "")) continue;
      if (assetCodeQ && a.old_code.toLowerCase() !== assetCodeQ) continue;
      assetCount++;
    }
    const kpi = {
      assets: assetCount,
      pmAll: pmAllAssets.size,
      pmMedia: pmMediaAssets.size,
      pmNonMedia: pmNonMediaAssets.size,
    };

    // ---- Pair PM → next Claim per asset ----
    type HistN = Hist & { _ts: number; _inFilter: boolean };
    const byAsset = new Map<string, HistN[]>();
    for (const h of allHist) {
      const code = h.asset_old_code ?? "";
      if (!code) continue;
      const ts = new Date(h.createdDate).getTime();
      if (!Number.isFinite(ts)) continue;
      const item: HistN = { ...h, _ts: ts, _inFilter: inFilter(h) };
      const list = byAsset.get(code) ?? [];
      list.push(item);
      byAsset.set(code, list);
    }

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
    };

    const pairs: Pair[] = [];
    for (const [code, list] of byAsset) {
      list.sort((a, b) => a._ts - b._ts);
      for (let i = 0; i < list.length; i++) {
        const h = list[i];
        if (h.type !== "PM") continue;
        if (h.assetStatus !== "Pass") continue;
        if (!h._inFilter) continue;
        const pmEnd = new Date(h.updatedDate || h.createdDate).getTime();
        if (!Number.isFinite(pmEnd)) continue;
        for (let j = i + 1; j < list.length; j++) {
          const c = list[j];
          if (c.type !== "Claim") continue;
          const cStart = new Date(c.createdDate).getTime();
          if (!Number.isFinite(cStart) || cStart < pmEnd) continue;
          const days = Math.max(1, Math.round((cStart - pmEnd) / 86400_000));
          pairs.push({
            assetCode: code,
            department: assetMap.get(code)?.department ?? "",
            mediaType: h.mediaType || assetMap.get(code)?.mediaType || "(ไม่ระบุ)",
            zone: h.bkkUpc || c.bkkUpc || "",
            project: h.project || c.project || "",
            pmDate: new Date(pmEnd).toISOString().slice(0, 10),
            claimDate: new Date(cStart).toISOString().slice(0, 10),
            pmTicket: h.ticket_code || "",
            claimTicket: c.ticket_code || "",
            days,
            problemCategory: c.problemCategory || "(ไม่ระบุ)",
            problemDetail: c.problemDetail || "(ไม่ระบุ)",
            problemEquipment: c.problemEquipment || "(ไม่ระบุ)",
            solutionCategory: c.solutionCategory || "(ไม่ระบุ)",
            solutionDetail: c.solutionDetail || "(ไม่ระบุ)",
          });
          break;
        }
      }
    }

    // Monthly PM vs Claim (current year, ignores date filter for full-year view)
    const year = new Date().getFullYear();
    const monthlyMap = new Map<number, { pm: number; claim: number }>();
    for (let m = 0; m < 12; m++) monthlyMap.set(m, { pm: 0, claim: 0 });
    for (const h of allHist) {
      if (!inScopeFilter(h)) continue;
      const d = new Date(h.createdDate);
      if (!Number.isFinite(d.getTime()) || d.getFullYear() !== year) continue;
      const row = monthlyMap.get(d.getMonth())!;
      if (h.type === "PM") row.pm++;
      else row.claim++;
    }
    const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthly = MONTH_LABELS.map((label, i) => ({
      month: label,
      pm: monthlyMap.get(i)!.pm,
      claim: monthlyMap.get(i)!.claim,
    }));

    // Aging histogram
    const agingMap = new Map<string, number>();
    for (const b of BUCKETS) agingMap.set(b.key, 0);
    for (const p of pairs) agingMap.set(bucketOf(p.days), (agingMap.get(bucketOf(p.days)) ?? 0) + 1);
    const aging = BUCKETS.map((b) => ({ bucket: b.key, count: agingMap.get(b.key) ?? 0 }));

    // Top defect donuts (pairs <= 30 days)
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

    // Monthly score per department
    type MonthRow = {
      month: string;
      department: string;
      score: number | null;
      pmCount: number;
      claimCount: number;
    };
    const scoreMap = new Map<string, { sum: number; n: number; pm: number; claim: number }>();
    const deptSet = new Set<string>();
    for (const h of filtered) {
      if (h.type !== "PM" || h.assetStatus !== "Pass") continue;
      const code = h.asset_old_code ?? "";
      const dept = (assetMap.get(code)?.department || "").trim() || "(ไม่มีสังกัดแผนก)";
      deptSet.add(dept);
      const date = h.updatedDate || h.createdDate;
      if (!date) continue;
      const m = date.slice(0, 7);
      const key = `${m}|${dept}`;
      const v = scoreMap.get(key) ?? { sum: 0, n: 0, pm: 0, claim: 0 };
      v.pm++;
      scoreMap.set(key, v);
    }
    for (const p of pairs) {
      const m = p.pmDate.slice(0, 7);
      const dept = p.department || "(ไม่ระบุ)";
      deptSet.add(dept);
      const key = `${m}|${dept}`;
      const v = scoreMap.get(key) ?? { sum: 0, n: 0, pm: 0, claim: 0 };
      const point = (Math.min(p.days, 90) / 90) * 100;
      v.sum += point;
      v.n++;
      v.claim++;
      scoreMap.set(key, v);
    }
    const scoreYear = new Date().getFullYear();
    const scoreRows: MonthRow[] = [];
    for (const dept of Array.from(deptSet).sort()) {
      for (let mi = 0; mi < 12; mi++) {
        const month = `${scoreYear}-${String(mi + 1).padStart(2, "0")}`;
        const v = scoreMap.get(`${month}|${dept}`);
        if (!v || v.pm === 0) {
          scoreRows.push({ month, department: dept, score: null, pmCount: 0, claimCount: v?.claim ?? 0 });
          continue;
        }
        const unpaired = Math.max(v.pm - v.claim, 0);
        const totalN = v.n + unpaired;
        const score = totalN > 0 ? (v.sum + unpaired * 100) / totalN : 0;
        scoreRows.push({
          month,
          department: dept,
          score: Math.round(score),
          pmCount: v.pm,
          claimCount: v.claim,
        });
      }
    }

    // Frequency per asset
    const now = new Date();
    const yearStart = `${now.getFullYear()}-01-01`;
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    type FreqRow = {
      assetCode: string;
      department: string;
      mediaType: string;
      zone: string;
      pmYear: number;
      pmMonth: number;
      avgGapDays: number | null;
      claimsAfterPM: number;
    };
    const freqMap = new Map<string, FreqRow>();
    for (const [code, list] of byAsset) {
      const asset = assetMap.get(code);
      const sampleH = list[0];
      if (sampleH && !inScopeFilter(sampleH)) continue;
      if (!sampleH) {
        const dept = asset?.department ?? "";
        if (depSet.size && !depSet.has(dept)) continue;
        if (mtSet.size && !mtSet.has(asset?.mediaType ?? "")) continue;
      }
      const dept = asset?.department ?? "";
      const zone = list.find((h) => h.bkkUpc)?.bkkUpc ?? "";
      const pms = list
        .filter((h) => h.type === "PM" && h.assetStatus === "Pass")
        .map((h) => ({
          date: h.updatedDate || h.createdDate,
          ts: h._ts,
        }))
        .filter((x) => x.date)
        .sort((a, b) => a.ts - b.ts);
      const gaps: number[] = [];
      for (let i = 1; i < pms.length; i++) gaps.push((pms[i].ts - pms[i - 1].ts) / 86400_000);
      const claimsAfter = pairs.filter((p) => p.assetCode === code).length;
      freqMap.set(code, {
        assetCode: code,
        department: dept,
        mediaType: list.find((h) => h.mediaType)?.mediaType || asset?.mediaType || "(ไม่ระบุ)",
        zone,
        pmYear: pms.filter((p) => p.date >= yearStart).length,
        pmMonth: pms.filter((p) => p.date >= monthStart).length,
        avgGapDays: gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null,
        claimsAfterPM: claimsAfter,
      });
    }
    const frequency = Array.from(freqMap.values())
      .filter((r) => r.pmYear > 0 || r.claimsAfterPM > 0)
      .sort((a, b) => b.pmYear - a.pmYear)
      .slice(0, 500);

    function aggBy(key: "mediaType" | "department" | "zone") {
      const m = new Map<string, { pm: number; claim: number; assets: number }>();
      for (const r of frequency) {
        const k = (r[key] || "(ไม่ระบุ)") as string;
        const v = m.get(k) ?? { pm: 0, claim: 0, assets: 0 };
        v.pm += r.pmYear;
        v.claim += r.claimsAfterPM;
        v.assets += 1;
        m.set(k, v);
      }
      return Array.from(m.entries())
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.pm - a.pm);
    }
    const freqAgg = {
      byMediaType: aggBy("mediaType").slice(0, 15),
      byDepartment: aggBy("department"),
      byZone: aggBy("zone").slice(0, 15),
    };

    pairs.sort((a, b) => a.days - b.days);

    return {
      kpi,
      monthly,
      aging,
      donuts,
      scoreRows,
      frequency,
      freqAgg,
      pairs: pairs.slice(0, 2000),
      filters: {
        departments: Array.from(allDepts).sort(),
        zones: Array.from(allZones).sort(),
        projects: Array.from(allProjects).sort(),
        mediaTypes: Array.from(allMediaTypes).sort(),
      },
    };
  });

// Lightweight server fn — returns only filter dropdown options + asset codes.
// Used so the filter UI populates quickly on mount, without waiting for
// the heavy PM-pair / aging / score computation.
export const getPmInsightsFilterOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
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

    type AssetLite = { old_code: string; department: string | null; payload: Record<string, unknown> | null };
    const assets = await fetchAll<AssetLite>((from, to) =>
      supabaseAdmin.from("assets").select("old_code, department, payload").range(from, to),
    );
    type HistLite = { project: string | null; payload: Record<string, unknown> | null };
    const hist = await fetchAll<HistLite>((from, to) =>
      supabaseAdmin
        .from("mssql_asset_history")
        .select("project, payload")
        .in("payload->>Category", ["PM (Media)", "PM (non Media)", "Claim"])
        .range(from, to),
    );

    const deps = new Set<string>();
    const zones = new Set<string>();
    const projects = new Set<string>();
    const mediaTypes = new Set<string>();
    const assetCodes = new Set<string>();
    for (const a of assets) {
      if (a.department) deps.add(a.department);
      assetCodes.add(a.old_code);
      const p = (a.payload ?? {}) as Record<string, unknown>;
      const mt = p?.MediaType;
      if (typeof mt === "string" && mt) mediaTypes.add(mt);
    }
    for (const h of hist) {
      const p = (h.payload ?? {}) as Record<string, unknown>;
      const proj = (typeof p?.Project === "string" && p.Project) || h.project || "";
      if (proj) projects.add(proj);
      const bkk = p?.BKKUPC;
      if (typeof bkk === "string" && bkk) zones.add(bkk);
      const mt = p?.MediaType;
      if (typeof mt === "string" && mt) mediaTypes.add(mt);
    }
    return {
      departments: Array.from(deps).sort(),
      zones: Array.from(zones).sort(),
      projects: Array.from(projects).sort(),
      mediaTypes: Array.from(mediaTypes).sort(),
      assetCodes: Array.from(assetCodes).sort(),
    };
  });
