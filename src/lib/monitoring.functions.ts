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
  fromDate: z.string().optional().nullable(),
  toDate: z.string().optional().nullable(),
});

export type MonitoringFilters = z.infer<typeof filtersSchema>;

const BUCKETS = [
  { key: "1-3", min: 1, max: 3 },
  { key: "4-7", min: 4, max: 7 },
  { key: "8-15", min: 8, max: 15 },
  { key: "16-30", min: 16, max: 30 },
  { key: "31-60", min: 31, max: 60 },
  { key: "61-90", min: 61, max: 90 },
  { key: ">90", min: 91, max: Infinity },
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

type AssetRow = {
  old_code: string;
  name: string | null;
  department: string | null;
  area: string | null;
  payload: Record<string, unknown> | null;
};
type HistRow = {
  asset_old_code: string | null;
  type: string;
  opened_at: string | null;
  closed_at: string | null;
  status: string | null;
  ticket_code: string | null;
  payload: Record<string, unknown> | null;
};
type ClaimTicketRow = {
  ref_number: string;
  asset_old_code: string | null;
  opened_at: string | null;
  status: string | null;
  informed_detail: string | null;
  payload: Record<string, unknown> | null;
};

function pstr(p: Record<string, unknown> | null | undefined, k: string): string {
  const v = p?.[k];
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function parseDate(s: string | null | undefined): number {
  if (!s) return NaN;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : NaN;
}
function dayStr(s: string | null | undefined): string {
  if (!s) return "";
  return s.length >= 10 ? s.slice(0, 10) : s;
}
function daysBetween(a: number, b: number): number {
  return Math.floor((b - a) / 86_400_000);
}

export const getMonitoringData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => filtersSchema.parse(i ?? {}))
  .handler(async ({ data: f }) => {
    const [assetsRaw, histRaw, claimRaw] = await Promise.all([
      fetchAll<AssetRow>((from, to) =>
        supabaseAdmin.from("assets").select("old_code, name, department, area, payload").range(from, to),
      ),
      fetchAll<HistRow>((from, to) =>
        supabaseAdmin
          .from("asset_history")
          .select("asset_old_code, type, opened_at, closed_at, status, ticket_code, payload")
          .range(from, to),
      ),
      fetchAll<ClaimTicketRow>((from, to) =>
        supabaseAdmin
          .from("claim_tickets")
          .select("ref_number, asset_old_code, opened_at, status, informed_detail, payload")
          .range(from, to),
      ),
    ]);

    // Active assets only
    const activeCodes = new Set<string>();
    for (const r of assetsRaw) {
      const del = r.payload && typeof r.payload === "object" ? (r.payload as Record<string, unknown>).IsDeleted : null;
      if (del !== true && del !== "true") activeCodes.add(r.old_code);
    }
    const assetMap = new Map<string, { code: string; name: string; department: string; area: string; mediaType: string; project: string; zone: string }>();
    for (const r of assetsRaw) {
      if (!activeCodes.has(r.old_code) || assetMap.has(r.old_code)) continue;
      const p = (r.payload ?? {}) as Record<string, unknown>;
      assetMap.set(r.old_code, {
        code: r.old_code,
        name: r.name ?? "",
        department: r.department ?? "",
        area: r.area ?? "",
        mediaType: typeof p.MediaType === "string" ? (p.MediaType as string) : "",
        project: typeof p.Project === "string" ? (p.Project as string) : "",
        zone: typeof p.BkkUpc === "string" ? (p.BkkUpc as string) : "",
      });
    }

    // Filter scope
    const depSet = new Set(f.departments);
    const zoneSet = new Set(f.zones);
    const projSet = new Set(f.projects);
    const projDeptSet = departmentsForProjects(f.projects);
    const mtSet = new Set(f.mediaTypes);
    const fromTs = f.fromDate ? new Date(f.fromDate).getTime() : -Infinity;
    const toTs = f.toDate ? new Date(f.toDate).getTime() + 86_400_000 : Infinity;

    function matchAsset(a: { department: string; project: string; zone: string; mediaType: string }): boolean {
      if (depSet.size && !depSet.has(a.department)) return false;
      if (projSet.size && !(projSet.has(a.project) || projDeptSet.has(a.department))) return false;
      if (zoneSet.size && !zoneSet.has(a.zone)) return false;
      if (mtSet.size && !mtSet.has(a.mediaType)) return false;
      return true;
    }

    const inScopeAssets = new Map<string, typeof assetMap extends Map<string, infer V> ? V : never>();
    for (const a of assetMap.values()) {
      if (matchAsset(a)) inScopeAssets.set(a.code, a);
    }

    // Build per-asset PM history (sorted) and Claim ticket lists
    type PmEvent = { date: number; dateStr: string; assetStatus: string };
    const pmByAsset = new Map<string, PmEvent[]>();
    const claimByAsset = new Map<string, { date: number; dateStr: string; refNumber: string; informDetail: string; problemCategory: string; problemDetail: string; status: string }[]>();

    for (const h of histRaw) {
      if (!h.asset_old_code || !inScopeAssets.has(h.asset_old_code)) continue;
      const p = h.payload ?? {};
      const dateStr = pstr(p, "createdDate") || dayStr(h.opened_at);
      const d = parseDate(dateStr);
      if (!Number.isFinite(d)) continue;
      if (h.type === "PM") {
        const arr = pmByAsset.get(h.asset_old_code) ?? [];
        arr.push({ date: d, dateStr, assetStatus: pstr(p, "assetStatus") || "?" });
        pmByAsset.set(h.asset_old_code, arr);
      } else if (h.type === "Claim") {
        const arr = claimByAsset.get(h.asset_old_code) ?? [];
        arr.push({
          date: d,
          dateStr,
          refNumber: h.ticket_code ?? "",
          informDetail: pstr(p, "informDetail"),
          problemCategory: pstr(p, "problemCategory"),
          problemDetail: pstr(p, "problemDetail"),
          status: h.status ?? pstr(p, "status"),
        });
        claimByAsset.set(h.asset_old_code, arr);
      }
    }
    for (const arr of pmByAsset.values()) arr.sort((a, b) => a.date - b.date);
    for (const arr of claimByAsset.values()) arr.sort((a, b) => a.date - b.date);

    // ---------- Tab 2: Inspection status per asset ----------
    const now = Date.now();
    type InspectionRow = {
      assetCode: string;
      department: string;
      project: string;
      pmCount: number;
      lastPmDate: string;
      daysSinceLastPm: number | null;
      avgIntervalDays: number | null;
      lastStatus: string;
    };
    const inspectionRows: InspectionRow[] = [];
    for (const a of inScopeAssets.values()) {
      const pms = pmByAsset.get(a.code) ?? [];
      let avg: number | null = null;
      if (pms.length >= 2) {
        let sum = 0;
        for (let i = 1; i < pms.length; i++) sum += (pms[i].date - pms[i - 1].date) / 86_400_000;
        avg = Math.round(sum / (pms.length - 1));
      }
      const last = pms[pms.length - 1];
      inspectionRows.push({
        assetCode: a.code,
        department: a.department,
        project: a.project,
        pmCount: pms.length,
        lastPmDate: last?.dateStr ?? "",
        daysSinceLastPm: last ? Math.floor((now - last.date) / 86_400_000) : null,
        avgIntervalDays: avg,
        lastStatus: last?.assetStatus ?? "?",
      });
    }
    // Sort: never-inspected first, then by longest-since-last-PM
    inspectionRows.sort((a, b) => {
      if (a.pmCount === 0 && b.pmCount !== 0) return -1;
      if (b.pmCount === 0 && a.pmCount !== 0) return 1;
      const da = a.daysSinceLastPm ?? -1;
      const db = b.daysSinceLastPm ?? -1;
      return db - da;
    });

    // ---------- Tab 3: PM → Claim pairs ----------
    type PairRow = {
      assetCode: string;
      department: string;
      pmDate: string;
      claimDate: string;
      claimRef: string;
      days: number;
      problemCategory: string;
      problemDetail: string;
      informDetail: string;
    };
    const pairs: PairRow[] = [];
    for (const [code, pms] of pmByAsset) {
      const a = inScopeAssets.get(code);
      if (!a) continue;
      const claims = claimByAsset.get(code) ?? [];
      for (const pm of pms) {
        // honor date filter on PM event
        if (pm.date < fromTs || pm.date > toTs) continue;
        // find next claim after pm
        const next = claims.find((c) => c.date >= pm.date);
        if (!next) continue;
        const days = daysBetween(pm.date, next.date);
        if (days < 0) continue;
        pairs.push({
          assetCode: code,
          department: a.department,
          pmDate: pm.dateStr,
          claimDate: next.dateStr,
          claimRef: next.refNumber,
          days,
          problemCategory: next.problemCategory || "(ไม่ระบุ)",
          problemDetail: next.problemDetail || "(ไม่ระบุ)",
          informDetail: next.informDetail || "(ไม่ระบุ)",
        });
      }
    }

    const agingMap = new Map<string, number>();
    for (const b of BUCKETS) agingMap.set(b.key, 0);
    for (const p of pairs) {
      const k = bucketOf(p.days);
      if (k) agingMap.set(k, (agingMap.get(k) ?? 0) + 1);
    }
    const aging = BUCKETS.map((b) => ({ bucket: b.key, count: agingMap.get(b.key) ?? 0 }));

    // Top early-fail symptoms (≤7 days)
    function topN(arr: string[], n: number) {
      const m = new Map<string, number>();
      for (const v of arr) if (v && v !== "(ไม่ระบุ)") m.set(v, (m.get(v) ?? 0) + 1);
      return Array.from(m.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, n);
    }
    const earlyFails = pairs.filter((p) => p.days <= 7);
    const earlySymptoms = topN(earlyFails.map((p) => p.informDetail || p.problemDetail), 8);

    // ---------- Tab 1: Overview ----------
    // Inspection status pie: Pass / Fail / Never
    let passCount = 0, failCount = 0, neverCount = 0;
    for (const r of inspectionRows) {
      if (r.pmCount === 0) neverCount++;
      else if (r.lastStatus === "Pass") passCount++;
      else failCount++;
    }
    const statusPie = [
      { name: "ตรวจผ่าน", value: passCount },
      { name: "ตรวจไม่ผ่าน/รอ", value: failCount },
      { name: "ยังไม่เคยตรวจ", value: neverCount },
    ];

    // Stacked bar by department
    const deptAgg = new Map<string, { dept: string; pass: number; fail: number; never: number }>();
    for (const r of inspectionRows) {
      const d = r.department || "(ไม่ระบุ)";
      const v = deptAgg.get(d) ?? { dept: d, pass: 0, fail: 0, never: 0 };
      if (r.pmCount === 0) v.never++;
      else if (r.lastStatus === "Pass") v.pass++;
      else v.fail++;
      deptAgg.set(d, v);
    }
    const byDepartment = Array.from(deptAgg.values()).sort((a, b) => (b.pass + b.fail + b.never) - (a.pass + a.fail + a.never));

    // Top symptoms from all claim_tickets in-scope
    const ticketSymptoms: string[] = [];
    for (const t of claimRaw) {
      if (!t.asset_old_code || !inScopeAssets.has(t.asset_old_code)) continue;
      const d = parseDate(pstr(t.payload, "createdDate") || dayStr(t.opened_at));
      if (Number.isFinite(d) && (d < fromTs || d > toTs)) continue;
      const s = t.informed_detail || pstr(t.payload, "informDetail") || pstr(t.payload, "problemDetail");
      if (s) ticketSymptoms.push(s);
    }
    const topSymptoms = topN(ticketSymptoms, 10);

    // ---------- Tab 4: Asset list (claim tickets join) ----------
    type TicketRow = {
      assetCode: string;
      department: string;
      refNumber: string;
      createdDate: string;
      updatedDate: string;
      closedDate: string;
      status: string;
      pending: boolean;
      lastInspectStatus: string;
    };
    const ticketRows: TicketRow[] = [];
    for (const t of claimRaw) {
      const code = t.asset_old_code;
      if (!code) continue;
      const a = inScopeAssets.get(code);
      if (!a) continue;
      const p = t.payload ?? {};
      const created = pstr(p, "createdDate") || dayStr(t.opened_at);
      const updated = pstr(p, "updatedDate");
      const status = (t.status || pstr(p, "status") || "").trim();
      const closedDate = status === "Finished" || status === "Closed" || status === "Approved" ? updated : "";
      const cTs = parseDate(created);
      if (Number.isFinite(cTs) && (cTs < fromTs || cTs > toTs)) continue;
      const inspection = inspectionRows.find((r) => r.assetCode === code);
      ticketRows.push({
        assetCode: code,
        department: a.department,
        refNumber: t.ref_number,
        createdDate: created,
        updatedDate: updated,
        closedDate,
        status,
        pending: !!created && !!updated && created === updated,
        lastInspectStatus: inspection?.lastStatus ?? "?",
      });
    }
    ticketRows.sort((a, b) => (b.createdDate || "").localeCompare(a.createdDate || ""));

    // ---------- KPIs ----------
    const totalAssets = inScopeAssets.size;
    const neverPm = neverCount;
    const earlyFail7 = pairs.filter((p) => p.days <= 7 && p.days >= 0).length;
    const pendingTickets = ticketRows.filter((t) => t.pending && t.status !== "Finished" && t.status !== "Closed" && t.status !== "Approved").length;

    const kpi = {
      totalAssets,
      neverPm,
      earlyFail7,
      pendingTickets,
    };

    // ---------- Filter options ----------
    const optDept = new Set<string>();
    const optZone = new Set<string>();
    const optProject = new Set<string>();
    const optMedia = new Set<string>();
    for (const a of assetMap.values()) {
      if (a.department) optDept.add(a.department);
      if (a.zone) optZone.add(a.zone);
      if (a.project) optProject.add(a.project);
      if (a.mediaType) optMedia.add(a.mediaType);
    }
    const filters = {
      departments: Array.from(optDept).sort(),
      zones: Array.from(optZone).sort(),
      projects: Array.from(optProject).sort(),
      mediaTypes: Array.from(optMedia).sort(),
    };

    return {
      kpi,
      filters,
      statusPie,
      byDepartment,
      topSymptoms,
      inspectionRows,
      aging,
      pairs,
      earlySymptoms,
      ticketRows,
    };
  });
