import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const filtersSchema = z.object({
  departments: z.array(z.string()).optional().default([]),
  zones: z.array(z.string()).optional().default([]),
  projects: z.array(z.string()).optional().default([]),
  fromDate: z.string().optional().nullable(),
  toDate: z.string().optional().nullable(),
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

type Hist = {
  asset_old_code: string | null;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type Asset = { old_code: string; department: string | null };

function asPayload(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function pickStr(p: Record<string, unknown>, k: string): string {
  const v = p?.[k];
  return typeof v === "string" ? v : "";
}
function pickNum(p: Record<string, unknown>, k: string): number {
  const v = p?.[k];
  return typeof v === "number" ? v : 0;
}

export const getPmInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => filtersSchema.parse(i ?? {}))
  .handler(async ({ data: f }) => {
    // ---- Pull data ----
    const assetsRes = await supabaseAdmin
      .from("assets")
      .select("old_code, department")
      .limit(20000);
    if (assetsRes.error) throw new Error(assetsRes.error.message);
    const assetMap = new Map<string, Asset>();
    for (const a of assetsRes.data ?? []) assetMap.set(a.old_code, a as Asset);

    // history (PM + Claim)
    const { data: hist, error: hErr } = await supabaseAdmin
      .from("asset_history")
      .select("asset_old_code, type, payload, created_at")
      .in("type", ["PM", "Claim"])
      .limit(50000);
    if (hErr) throw new Error(hErr.message);

    const mapRes = await supabaseAdmin
      .from("informed_mapping")
      .select("informed, impact_level, informed_group, informed_detail");
    if (mapRes.error) throw new Error(mapRes.error.message);
    const mapByDetail = new Map<string, { impact: string; group: string | null }>();
    const mapByInformed = new Map<string, { impact: string; group: string | null }>();
    for (const m of mapRes.data ?? []) {
      mapByDetail.set(m.informed_detail, {
        impact: m.impact_level,
        group: m.informed_group,
      });
      mapByInformed.set(m.informed, {
        impact: m.impact_level,
        group: m.informed_group,
      });
    }

    // ---- Filter helpers ----
    const fromTs = f.fromDate ? new Date(f.fromDate).getTime() : -Infinity;
    const toTs = f.toDate ? new Date(f.toDate).getTime() + 86400_000 : Infinity;
    const depSet = new Set(f.departments);
    const zoneSet = new Set(f.zones);
    const projSet = new Set(f.projects);

    function inFilter(h: Hist): boolean {
      const code = h.asset_old_code ?? "";
      const asset = assetMap.get(code);
      const dept = asset?.department ?? "";
      const created = pickStr(h.payload, "createdDate") || h.created_at;
      const ts = new Date(created).getTime();
      if (Number.isFinite(ts) && (ts < fromTs || ts > toTs)) return false;
      if (depSet.size && !depSet.has(dept)) return false;
      if (zoneSet.size && !zoneSet.has(pickStr(h.payload, "bkkUpc"))) return false;
      if (projSet.size && !projSet.has(pickStr(h.payload, "project"))) return false;
      return true;
    }

    // For filter dropdowns: collect distinct values from full dataset
    const allDepts = new Set<string>();
    const allZones = new Set<string>();
    const allProjects = new Set<string>();
    for (const a of assetMap.values()) if (a.department) allDepts.add(a.department);
    for (const h of hist ?? []) {
      const z = pickStr(asPayload(h.payload), "bkkUpc");
      if (z) allZones.add(z);
      const p = pickStr(asPayload(h.payload), "project");
      if (p) allProjects.add(p);
    }

    const filtered: Hist[] = (hist ?? [])
      .map((h) => ({ ...h, payload: asPayload(h.payload) }))
      .filter(inFilter);

    // ---- KPIs ----
    let downtime = 0;
    let pmDone = 0;
    let claimOpen = 0;
    const assetCodes = new Set<string>();
    for (const h of filtered) {
      assetCodes.add(h.asset_old_code ?? "");
      if (h.type === "PM" && pickStr(h.payload, "assetStatus") === "Pass") pmDone++;
      if (h.type === "Claim") {
        downtime += pickNum(h.payload, "totalTurnaroundTime");
        const st = pickStr(h.payload, "status");
        if (st !== "Finished" && pickStr(h.payload, "assetStatus") !== "Pass") claimOpen++;
      }
    }
    const kpi = {
      assets: assetCodes.size,
      pmDone,
      claimOpen,
      downtimeHours: Math.round(downtime / 60),
    };

    // ---- Pair PM -> next Claim per asset ----
    type HistN = Hist & { _ts: number };
    const byAsset = new Map<string, HistN[]>();
    for (const h of filtered) {
      const code = h.asset_old_code ?? "";
      if (!code) continue;
      const ts = new Date(pickStr(h.payload, "createdDate") || h.created_at).getTime();
      if (!Number.isFinite(ts)) continue;
      const item = { ...h, _ts: ts };
      const list = byAsset.get(code) ?? [];
      list.push(item);
      byAsset.set(code, list);
    }

    type Pair = {
      assetCode: string;
      department: string;
      pmDate: string;
      claimDate: string;
      days: number;
      problemCategory: string;
      problemDetail: string;
      problemEquipment: string;
      solutionCategory: string;
      solutionDetail: string;
      impactLevel: string;
      informedGroup: string | null;
      downtimeMin: number;
    };

    const pairs: Pair[] = [];
    for (const [code, list] of byAsset) {
      list.sort((a, b) => a._ts - b._ts);
      for (let i = 0; i < list.length; i++) {
        const h = list[i];
        if (h.type !== "PM") continue;
        if (pickStr(h.payload, "assetStatus") !== "Pass") continue;
        const pmEnd = new Date(
          pickStr(h.payload, "updatedDate") || pickStr(h.payload, "createdDate"),
        ).getTime();
        if (!Number.isFinite(pmEnd)) continue;
        // find first claim after pmEnd
        for (let j = i + 1; j < list.length; j++) {
          const c = list[j];
          if (c.type !== "Claim") continue;
          const cStart = new Date(pickStr(c.payload, "createdDate")).getTime();
          if (!Number.isFinite(cStart) || cStart < pmEnd) continue;
          const days = Math.max(1, Math.round((cStart - pmEnd) / 86400_000));
          const detail = pickStr(c.payload, "problemDetail");
          const cat = pickStr(c.payload, "problemCategory");
          const m = mapByDetail.get(detail) ?? mapByInformed.get(cat);
          pairs.push({
            assetCode: code,
            department: assetMap.get(code)?.department ?? "",
            pmDate: new Date(pmEnd).toISOString().slice(0, 10),
            claimDate: new Date(cStart).toISOString().slice(0, 10),
            days,
            problemCategory: cat || "(ไม่ระบุ)",
            problemDetail: detail || "(ไม่ระบุ)",
            problemEquipment: pickStr(c.payload, "problemEquipment") || "(ไม่ระบุ)",
            solutionCategory: pickStr(c.payload, "solutionCategory") || "(ไม่ระบุ)",
            solutionDetail: pickStr(c.payload, "solutionDetail") || "(ไม่ระบุ)",
            impactLevel: m?.impact ?? "ไม่มีผลต่อการมองเห็น",
            informedGroup: m?.group ?? null,
            downtimeMin: pickNum(c.payload, "totalTurnaroundTime"),
          });
          break;
        }
      }
    }

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

    // Impact stacked bar (department × 3 impact levels, hours)
    const impactByDept = new Map<string, Record<string, number>>();
    for (const h of filtered) {
      if (h.type !== "Claim") continue;
      const code = h.asset_old_code ?? "";
      const dept = assetMap.get(code)?.department ?? "(ไม่ระบุ)";
      const detail = pickStr(h.payload, "problemDetail");
      const cat = pickStr(h.payload, "problemCategory");
      const m = mapByDetail.get(detail) ?? mapByInformed.get(cat);
      const impact = m?.impact ?? "ไม่มีผลต่อการมองเห็น";
      const hours = pickNum(h.payload, "totalTurnaroundTime") / 60;
      const row = impactByDept.get(dept) ?? {};
      row[impact] = (row[impact] ?? 0) + hours;
      impactByDept.set(dept, row);
    }
    const impactStack = Array.from(impactByDept.entries())
      .map(([department, levels]) => ({
        department,
        จอดับ: Math.round(levels["จอดับ/ไม่เห็นโฆษณา"] ?? 0),
        ไม่สมบูรณ์: Math.round(levels["แสดงผลไม่สมบูรณ์"] ?? 0),
        ไม่มีผล: Math.round(levels["ไม่มีผลต่อการมองเห็น"] ?? 0),
        total:
          Math.round(
            (levels["จอดับ/ไม่เห็นโฆษณา"] ?? 0) +
              (levels["แสดงผลไม่สมบูรณ์"] ?? 0) +
              (levels["ไม่มีผลต่อการมองเห็น"] ?? 0),
          ),
      }))
      .sort((a, b) => b.total - a.total);

    // Top informed_group by downtime
    const groupHours = new Map<string, number>();
    for (const h of filtered) {
      if (h.type !== "Claim") continue;
      const detail = pickStr(h.payload, "problemDetail");
      const cat = pickStr(h.payload, "problemCategory");
      const m = mapByDetail.get(detail) ?? mapByInformed.get(cat);
      const grp = m?.group ?? "(ไม่ระบุ)";
      groupHours.set(grp, (groupHours.get(grp) ?? 0) + pickNum(h.payload, "totalTurnaroundTime") / 60);
    }
    const groupTop = Array.from(groupHours.entries())
      .map(([name, hours]) => ({ name, hours: Math.round(hours) }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 15);

    // Monthly score (department × month)
    type MonthRow = { month: string; department: string; score: number; pmCount: number; claimCount: number };
    const scoreMap = new Map<string, { sum: number; n: number; pm: number; claim: number }>();
    // count PMs in month per department
    for (const h of filtered) {
      if (h.type !== "PM" || pickStr(h.payload, "assetStatus") !== "Pass") continue;
      const code = h.asset_old_code ?? "";
      const dept = assetMap.get(code)?.department ?? "(ไม่ระบุ)";
      const date = pickStr(h.payload, "updatedDate") || pickStr(h.payload, "createdDate");
      if (!date) continue;
      const m = date.slice(0, 7);
      const key = `${m}|${dept}`;
      const v = scoreMap.get(key) ?? { sum: 0, n: 0, pm: 0, claim: 0 };
      v.pm++;
      scoreMap.set(key, v);
    }
    for (const p of pairs) {
      const m = p.pmDate.slice(0, 7);
      const key = `${m}|${p.department || "(ไม่ระบุ)"}`;
      const v = scoreMap.get(key) ?? { sum: 0, n: 0, pm: 0, claim: 0 };
      const point = (Math.min(p.days, 90) / 90) * 100;
      v.sum += point;
      v.n++;
      v.claim++;
      scoreMap.set(key, v);
    }
    const scoreRows: MonthRow[] = Array.from(scoreMap.entries())
      .map(([key, v]) => {
        const [month, department] = key.split("|");
        // PMs without subsequent claim count as score 100
        const unpaired = Math.max(v.pm - v.claim, 0);
        const totalN = v.n + unpaired;
        const score = totalN > 0 ? (v.sum + unpaired * 100) / totalN : 0;
        return { month, department, score: Math.round(score), pmCount: v.pm, claimCount: v.claim };
      })
      .sort((a, b) => (a.month < b.month ? -1 : 1));

    // Frequency per asset (year/month PM count, avg gap, claims-per-gap-bucket)
    const now = new Date();
    const yearStart = `${now.getFullYear()}-01-01`;
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    type FreqRow = {
      assetCode: string;
      department: string;
      pmYear: number;
      pmMonth: number;
      avgGapDays: number | null;
      claimsAfterPM: number;
    };
    const freqMap = new Map<string, FreqRow>();
    for (const [code, list] of byAsset) {
      const dept = assetMap.get(code)?.department ?? "";
      const pms = list
        .filter((h) => h.type === "PM" && pickStr(h.payload, "assetStatus") === "Pass")
        .map((h) => ({
          date: pickStr(h.payload, "updatedDate") || pickStr(h.payload, "createdDate"),
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

    // Sort pairs by days asc (most critical first)
    pairs.sort((a, b) => a.days - b.days);

    return {
      kpi,
      aging,
      donuts,
      impactStack,
      groupTop,
      scoreRows,
      frequency,
      pairs: pairs.slice(0, 1000),
      filters: {
        departments: Array.from(allDepts).sort(),
        zones: Array.from(allZones).sort(),
        projects: Array.from(allProjects).sort(),
      },
    };
  });
