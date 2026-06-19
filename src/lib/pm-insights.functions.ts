import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { departmentsForProjects, projectForDepartment } from "@/lib/project-department-map";

const filtersSchema = z.object({
  departments: z.array(z.string()).optional().default([]),
  zones: z.array(z.string()).optional().default([]),
  projects: z.array(z.string()).optional().default([]),
  mediaTypes: z.array(z.string()).optional().default([]),
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

type HistRow = {
  ref_number: string;
  asset_old_code: string;
  created_at: string | null;
  updated_at: string | null;
  event_ts: string | null;
  category: string;
  type: "PM" | "Claim";
  project: string | null;
  media_type: string | null;
  bkk_upc: string | null;
  asset_status: string | null;
  status: string | null;
  problem_category: string | null;
  problem_detail: string | null;
  problem_equipment: string | null;
  solution_category: string | null;
  solution_detail: string | null;
  asset_department: string | null;
  asset_media_type: string | null;
};

type PairRow = {
  asset_old_code: string;
  pm_ref: string;
  pm_category: string;
  pm_end_ts: string;
  claim_ref: string | null;
  claim_ts: string | null;
  days: number | null;
  media_type: string | null;
  department: string | null;
  zone: string | null;
  project: string | null;
  problem_category: string | null;
  problem_detail: string | null;
  problem_equipment: string | null;
  solution_category: string | null;
  solution_detail: string | null;
};

type AssetLite = {
  old_code: string;
  name: string | null;
  department: string | null;
  area: string | null;
  asset_media_type: string | null;
};

export const getPmInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => filtersSchema.parse(i ?? {}))
  .handler(async ({ data: f }) => {
    // Pull pre-aggregated MV rows (already deduped + joined with assets)
    const [hist, pairsAll, assetsRaw] = await Promise.all([
      fetchAll<HistRow>((from, to) =>
        (supabaseAdmin as unknown as { from: (t: string) => any }).from("mv_pm_history").select("*").range(from, to),
      ),
      fetchAll<PairRow>((from, to) =>
        (supabaseAdmin as unknown as { from: (t: string) => any }).from("mv_pm_claim_pairs").select("*").range(from, to),
      ),
      fetchAll<{ old_code: string; name: string | null; department: string | null; area: string | null; payload: Record<string, unknown> | null }>(
        (from, to) => supabaseAdmin.from("assets").select("old_code, name, department, area, payload").range(from, to),
      ),
    ]);
    // Two-pass: a code is "active" if ANY row for that code is not deleted.
    // This avoids double-counting when assets has both deleted + active rows for the same old_code.
    const activeCodes = new Set<string>();
    for (const r of assetsRaw) {
      const p = r.payload as Record<string, unknown> | null;
      const del = p && typeof p === "object" ? (p as Record<string, unknown>).IsDeleted : null;
      if (del !== true && del !== "true") activeCodes.add(r.old_code);
    }
    const assetMap = new Map<string, AssetLite>();
    for (const r of assetsRaw) {
      if (!activeCodes.has(r.old_code)) continue;
      if (assetMap.has(r.old_code)) continue; // first active row wins
      const p = r.payload as Record<string, unknown> | null;
      const del = p && typeof p === "object" ? (p as Record<string, unknown>).IsDeleted : null;
      if (del === true || del === "true") continue;
      assetMap.set(r.old_code, {
        old_code: r.old_code,
        name: r.name,
        department: r.department,
        area: r.area,
        asset_media_type:
          p && typeof p === "object" && typeof (p as Record<string, unknown>).MediaType === "string"
            ? ((p as Record<string, unknown>).MediaType as string)
            : null,
      });
    }
    // For history filtering: exclude only when the code has NO active asset row at all.
    const deletedSet = new Set<string>();
    for (const r of assetsRaw) {
      if (!activeCodes.has(r.old_code)) deletedSet.add(r.old_code);
    }

    const fromTs = f.fromDate ? new Date(f.fromDate).getTime() : -Infinity;
    const toTs = f.toDate ? new Date(f.toDate).getTime() + 86400_000 : Infinity;
    const depSet = new Set(f.departments);
    const zoneSet = new Set(f.zones);
    const projSet = new Set(f.projects);
    const projDeptSet = departmentsForProjects(f.projects);
    const mtSet = new Set(f.mediaTypes);
    const assetCodeQ = (f.assetCode ?? "").trim().toLowerCase();

    function matchPmCategory(category: string, type: "PM" | "Claim"): boolean {
      if (type !== "PM") return true;
      if (f.pmCategory === "media") return category === "PM (Media)";
      if (f.pmCategory === "non-media") return category === "PM (non Media)";
      return true;
    }
    function matchProject(project: string, dept: string): boolean {
      if (!projSet.size) return true;
      if (projSet.has(project)) return true;
      if (dept && projDeptSet.has(dept)) return true;
      return false;
    }
    function inScopeHist(h: HistRow): boolean {
      if (h.asset_old_code && deletedSet.has(h.asset_old_code)) return false;
      const dept = h.asset_department ?? "";
      if (depSet.size && !depSet.has(dept)) return false;
      if (zoneSet.size && !zoneSet.has(h.bkk_upc ?? "")) return false;
      if (!matchProject(h.project ?? "", dept)) return false;
      const mt = h.media_type || h.asset_media_type || "";
      if (mtSet.size && !mtSet.has(mt)) return false;
      if (!matchPmCategory(h.category, h.type)) return false;
      if (assetCodeQ && (h.asset_old_code ?? "").toLowerCase() !== assetCodeQ) return false;
      return true;
    }

    function inFilterHist(h: HistRow): boolean {
      if (!inScopeHist(h)) return false;
      const ts = new Date(h.created_at ?? h.event_ts ?? 0).getTime();
      if (Number.isFinite(ts) && (ts < fromTs || ts > toTs)) return false;
      return true;
    }
    function inScopePair(p: PairRow): boolean {
      if (p.asset_old_code && deletedSet.has(p.asset_old_code)) return false;
      const dept = p.department ?? "";
      if (depSet.size && !depSet.has(dept)) return false;
      if (zoneSet.size && !zoneSet.has(p.zone ?? "")) return false;
      if (!matchProject(p.project ?? "", dept)) return false;
      if (mtSet.size && !mtSet.has(p.media_type ?? "")) return false;
      if (!matchPmCategory(p.pm_category, "PM")) return false;
      if (assetCodeQ && (p.asset_old_code ?? "").toLowerCase() !== assetCodeQ) return false;
      return true;
    }

    function inFilterPair(p: PairRow): boolean {
      if (!inScopePair(p)) return false;
      const ts = new Date(p.pm_end_ts).getTime();
      if (Number.isFinite(ts) && (ts < fromTs || ts > toTs)) return false;
      return true;
    }

    // ---- Filter dropdown options ----
    const allDepts = new Set<string>();
    const allZones = new Set<string>();
    const allProjects = new Set<string>();
    const allMediaTypes = new Set<string>();
    for (const a of assetMap.values()) {
      if (a.department) allDepts.add(a.department);
      if (a.asset_media_type) allMediaTypes.add(a.asset_media_type);
    }
    for (const h of hist) {
      if (h.bkk_upc) allZones.add(h.bkk_upc);
      if (h.project) allProjects.add(h.project);
      if (h.media_type) allMediaTypes.add(h.media_type);
    }

    const filteredHist = hist.filter(inFilterHist);

    // ---- KPIs ----
    // Build the set of assets in scope (passing asset-side filters: dept/project/mediaType/assetCode).
    // KPI invariant: total = pmMedia + pmNonMedia + noPm   AND   total = pmAll + noPm.
    const matchedAssetCodes = new Set<string>();
    for (const a of assetMap.values()) {
      if (depSet.size && !depSet.has(a.department ?? "")) continue;
      if (projSet.size && !(a.department && projDeptSet.has(a.department))) continue;
      if (mtSet.size && !mtSet.has(a.asset_media_type ?? "")) continue;
      if (assetCodeQ && a.old_code.toLowerCase() !== assetCodeQ) continue;
      matchedAssetCodes.add(a.old_code);
    }
    const pmAllAssets = new Set<string>();
    const pmMediaAssets = new Set<string>();
    const pmNonMediaAssets = new Set<string>();
    for (const h of filteredHist) {
      if (h.type !== "PM" || !h.asset_old_code) continue;
      if (!matchedAssetCodes.has(h.asset_old_code)) continue;
      pmAllAssets.add(h.asset_old_code);
      if (h.category === "PM (Media)") pmMediaAssets.add(h.asset_old_code);
      else if (h.category === "PM (non Media)") pmNonMediaAssets.add(h.asset_old_code);
    }
    // Make Media / non-Media disjoint — an asset with both is bucketed as Media.
    for (const code of pmMediaAssets) pmNonMediaAssets.delete(code);
    const assetCount = matchedAssetCodes.size;
    const noPmAssets: { assetCode: string; name: string; department: string; area: string; mediaType: string }[] = [];
    for (const code of matchedAssetCodes) {
      if (pmAllAssets.has(code)) continue;
      const a = assetMap.get(code)!;
      noPmAssets.push({
        assetCode: a.old_code,
        name: a.name ?? "",
        department: a.department ?? "",
        area: a.area ?? "",
        mediaType: a.asset_media_type ?? "",
      });
    }
    noPmAssets.sort((a, b) => a.assetCode.localeCompare(b.assetCode));
    // ---- Ticket-level PM KPIs (filtered) ----
    let pmTickets = 0, pmPass = 0, pmFail = 0, pmSkip = 0, pmPending = 0;
    const pmByAssetDates = new Map<string, number[]>();
    for (const h of filteredHist) {
      if (h.type !== "PM") continue;
      pmTickets++;
      const s = (h.asset_status ?? "").toLowerCase();
      if (s === "pass") pmPass++;
      else if (s === "fail") pmFail++;
      else if (s.includes("skip")) pmSkip++;
      else if (s === "pending") pmPending++;
      const code = h.asset_old_code;
      if (code) {
        const ts = new Date(h.created_at ?? h.event_ts ?? 0).getTime();
        if (Number.isFinite(ts)) {
          const arr = pmByAssetDates.get(code) ?? [];
          arr.push(ts);
          pmByAssetDates.set(code, arr);
        }
      }
    }
    let gapSum = 0, gapN = 0;
    for (const arr of pmByAssetDates.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => a - b);
      for (let i = 1; i < arr.length; i++) {
        gapSum += (arr[i] - arr[i - 1]) / 86400_000;
        gapN++;
      }
    }
    const pmAvgGapDays = gapN > 0 ? Math.round((gapSum / gapN) * 10) / 10 : null;

    const kpi = {
      assets: assetCount,
      pmAll: pmAllAssets.size,
      pmMedia: pmMediaAssets.size,
      pmNonMedia: pmNonMediaAssets.size,
      pmNone: noPmAssets.length,
      pmTickets,
      pmPass,
      pmFail,
      pmSkip,
      pmPending,
      pmAvgGapDays,
    };


    // ---- Pairs (from MV) ----
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
    const pairs: Pair[] = [];
    for (const p of pairsAll) {
      if (p.days == null || !p.claim_ts) continue;
      if (p.days < 1 || p.days > 90) continue; // ignore >90 — not "claim caused by PM"
      if (!inFilterPair(p)) continue;
      pairs.push({
        assetCode: p.asset_old_code,
        department: p.department ?? "",
        mediaType: p.media_type || "(ไม่ระบุ)",
        zone: p.zone ?? "",
        project: p.project ?? "",
        pmDate: p.pm_end_ts.slice(0, 10),
        claimDate: p.claim_ts.slice(0, 10),
        pmTicket: p.pm_ref,
        claimTicket: p.claim_ref ?? "",
        days: p.days,
        problemCategory: p.problem_category || "(ไม่ระบุ)",
        problemDetail: p.problem_detail || "(ไม่ระบุ)",
        problemEquipment: p.problem_equipment || "(ไม่ระบุ)",
        solutionCategory: p.solution_category || "(ไม่ระบุ)",
        solutionDetail: p.solution_detail || "(ไม่ระบุ)",
        status: "",
        assetStatus: "",
      });
    }

    // ---- Monthly PM vs Claim (current year, ignores date filter) ----
    const year = new Date().getFullYear();
    const monthlyMap = new Map<number, { pm: number; claim: number }>();
    type MonthTicket = {
      ticket: string;
      assetCode: string;
      date: string;
      status: string;
      category: string;
      department: string;
    };
    const monthlyDetailsMap = new Map<number, { pm: MonthTicket[]; claim: MonthTicket[] }>();
    for (let m = 0; m < 12; m++) {
      monthlyMap.set(m, { pm: 0, claim: 0 });
      monthlyDetailsMap.set(m, { pm: [], claim: [] });
    }
    // Date rule matches the "ค้นหาประวัติป้าย" page:
    //   PM    → updated_at (when the PM was actually performed)
    //   Claim → created_at (when the claim ticket was opened)
    function pickDate(h: HistRow): string | null {
      if (h.type === "PM") return h.updated_at ?? h.event_ts ?? h.created_at ?? null;
      return h.created_at ?? h.event_ts ?? h.updated_at ?? null;
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
        ticket: h.ref_number ?? "",
        assetCode: h.asset_old_code ?? "",
        date: src.slice(0, 10),
        status: h.status ?? "",
        category: h.category ?? "",
        department: h.asset_department ?? "",
      };
      if (h.type === "PM") {
        row.pm++;
        det.pm.push(item);
      } else {
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


    // ---- Aging ----
    const agingMap = new Map<string, number>();
    for (const b of BUCKETS) agingMap.set(b.key, 0);
    for (const p of pairs) {
      const k = bucketOf(p.days);
      if (k) agingMap.set(k, (agingMap.get(k) ?? 0) + 1);
    }
    const aging = BUCKETS.map((b) => ({ bucket: b.key, count: agingMap.get(b.key) ?? 0 }));

    // ---- Top defect donuts (pairs <= 30 days) ----
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

    // ---- Monthly score per department ----
    type MonthRow = {
      month: string;
      department: string;
      score: number | null;
      pmCount: number;
      claimCount: number;
    };
    const scoreMap = new Map<string, { sum: number; n: number; pm: number; claim: number }>();
    const deptSet = new Set<string>();
    for (const h of filteredHist) {
      if (h.type !== "PM" || h.asset_status !== "Pass") continue;
      // Per user: Project field is the "department" dimension for PM Score.
      const dept = (h.project || "").trim() || "(ไม่ระบุ)";
      deptSet.add(dept);
      const date = h.updated_at || h.created_at;
      if (!date) continue;
      const m = date.slice(0, 7);
      const key = `${m}|${dept}`;
      const v = scoreMap.get(key) ?? { sum: 0, n: 0, pm: 0, claim: 0 };
      v.pm++;
      scoreMap.set(key, v);
    }
    for (const p of pairs) {
      const m = p.pmDate.slice(0, 7);
      const dept = (p.project || "").trim() || "(ไม่ระบุ)";
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
    const deptsWithPm = new Set<string>();
    for (const [k, v] of scoreMap) {
      if (v.pm > 0) deptsWithPm.add(k.split("|")[1]);
    }
    for (const dept of Array.from(deptSet).sort()) {
      if (!deptsWithPm.has(dept)) continue;
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

    // ---- Frequency per asset ----
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

    const byAsset = new Map<string, HistRow[]>();
    for (const h of hist) {
      if (!h.asset_old_code) continue;
      if (!inScopeHist(h)) continue;
      const list = byAsset.get(h.asset_old_code) ?? [];
      list.push(h);
      byAsset.set(h.asset_old_code, list);
    }
    const claimsPerAsset = new Map<string, number>();
    for (const p of pairs) claimsPerAsset.set(p.assetCode, (claimsPerAsset.get(p.assetCode) ?? 0) + 1);

    const frequency: FreqRow[] = [];
    for (const [code, list] of byAsset) {
      const asset = assetMap.get(code);
      const dept = asset?.department ?? "";
      const zone = list.find((h) => h.bkk_upc)?.bkk_upc ?? "";
      const pms = list
        .filter((h) => h.type === "PM" && h.asset_status === "Pass")
        .map((h) => {
          const date = h.updated_at || h.created_at || "";
          return { date, ts: new Date(date).getTime() };
        })
        .filter((x) => x.date && Number.isFinite(x.ts))
        .sort((a, b) => a.ts - b.ts);
      const gaps: number[] = [];
      for (let i = 1; i < pms.length; i++) gaps.push((pms[i].ts - pms[i - 1].ts) / 86400_000);
      const claimsAfter = claimsPerAsset.get(code) ?? 0;
      frequency.push({
        assetCode: code,
        department: dept,
        mediaType: list.find((h) => h.media_type)?.media_type || asset?.asset_media_type || "(ไม่ระบุ)",
        zone,
        pmYear: pms.filter((p) => p.date >= yearStart).length,
        pmMonth: pms.filter((p) => p.date >= monthStart).length,
        avgGapDays: gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null,
        claimsAfterPM: claimsAfter,
      });
    }
    const frequencyTop = frequency
      .filter((r) => r.pmYear > 0 || r.claimsAfterPM > 0)
      .sort((a, b) => b.pmYear - a.pmYear)
      .slice(0, 500);

    function aggBy(key: "mediaType" | "department" | "zone") {
      const m = new Map<string, { pm: number; claim: number; assets: number }>();
      for (const r of frequencyTop) {
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

    // ---- All PM rows (for Show/Hide list in UI) ----
    type PmRow = {
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
    const pmRows: PmRow[] = [];
    for (const h of filteredHist) {
      if (h.type !== "PM") continue;
      const a = h.asset_old_code ? assetMap.get(h.asset_old_code) : undefined;
      pmRows.push({
        ticket: h.ref_number ?? "",
        assetCode: h.asset_old_code ?? "",
        assetName: a?.name ?? "",
        project: h.project ?? "",
        zone: h.bkk_upc ?? "",
        mediaType: h.media_type || h.asset_media_type || a?.asset_media_type || "",
        department: h.asset_department ?? a?.department ?? "",
        category: h.category ?? "",
        problemCategory: h.problem_category ?? "",
        problemDetail: h.problem_detail ?? "",
        createdDate: (h.created_at ?? "").slice(0, 19).replace("T", " "),
        updatedDate: (h.updated_at ?? "").slice(0, 19).replace("T", " "),
        eventDate: (h.event_ts ?? "").slice(0, 19).replace("T", " "),
        ticketStatus: h.status ?? "",
        assetStatus: h.asset_status ?? "",
        assetActive: h.asset_old_code && deletedSet.has(h.asset_old_code) ? "Deleted" : "Active",
      });
    }
    pmRows.sort((a, b) => (b.createdDate || "").localeCompare(a.createdDate || ""));
    const pmRowsTotal = pmRows.length;

    // ---- Calendar events (PM + Claim per day) ----
    type DayBuckets = { pm: Set<string>; claim: Set<string> };
    const calMap = new Map<string, DayBuckets>();
    for (const h of filteredHist) {
      const src = h.updated_at ?? h.event_ts ?? h.created_at ?? "";
      const date = src.slice(0, 10);
      if (!date) continue;
      let v = calMap.get(date);
      if (!v) { v = { pm: new Set(), claim: new Set() }; calMap.set(date, v); }
      const key = h.asset_old_code || h.ref_number || "";
      if (h.type === "PM") v.pm.add(key);
      else if (h.type === "Claim") v.claim.add(key);
    }
    const calendarDays = Array.from(calMap.entries())
      .map(([date, v]) => ({
        date,
        pm: v.pm.size,
        claim: v.claim.size,
        pmCodes: Array.from(v.pm).slice(0, 30),
        claimCodes: Array.from(v.claim).slice(0, 30),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      kpi,
      monthly,
      monthlyDetails,
      noPmAssets,

      aging,
      donuts,
      scoreRows,
      frequency: frequencyTop,
      freqAgg,
      pairs: pairs.slice(0, 2000),
      pmRows: pmRows.slice(0, 10000),
      pmRowsTotal,
      calendarDays,
      filters: {
        departments: Array.from(allDepts).sort(),
        zones: Array.from(allZones).sort(),
        projects: Array.from(allProjects).sort(),
        mediaTypes: Array.from(allMediaTypes).sort(),
      },
    };
  });


// Lightweight server fn — returns filter dropdown options + per-asset metadata
// so the client can interlock filters (project Static → only Static codes/zones/
// media types in other filters). PERF: derive every dimension from the assets
// table alone (zone = payload.BKKUPC, project = department→project map,
// mediaType = payload.MediaType). The previous version paginated the full
// mv_pm_history (slow first load, 8–10s).
export const getPmInsightsFilterOptions = createServerFn({ method: "POST" })
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
        typeof p?.BKKUPC === "string" ? (p.BKKUPC as string)
          : typeof p?.BkkUpc === "string" ? (p.BkkUpc as string)
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

// Manual refresh of PM materialized views (callable from settings UI).
export const refreshPmViews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { error } = await (supabaseAdmin as unknown as { rpc: (n: string) => Promise<{ error: { message: string } | null }> }).rpc("refresh_pm_views");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
