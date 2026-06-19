import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { departmentsForProjects, PROJECT_TO_DEPARTMENTS } from "@/lib/project-department-map";

const filtersSchema = z.object({
  oldCode: z.string().optional().default(""),
  zones: z.array(z.string()).optional().default([]),
  projects: z.array(z.string()).optional().default([]),
  mediaTypes: z.array(z.string()).optional().default([]),
  fromDate: z.string().optional().nullable(),
  toDate: z.string().optional().nullable(),
});

export type MonitoringFilters = z.infer<typeof filtersSchema>;

const BUCKETS = [
  { key: "0-3", min: 0, max: 3 },
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

// 4 inspection statuses (display order)
const STATUSES = ["Pending", "Pass", "Fail", "Skip"] as const;
type StatusKey = (typeof STATUSES)[number];
function normalizeStatus(s: string | null | undefined): StatusKey {
  const v = (s ?? "").trim().toLowerCase();
  if (v === "pass") return "Pass";
  if (v === "fail") return "Fail";
  if (v === "on skip" || v === "skip" || v === "skipped") return "Skip";
  return "Pending";
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

// Keyset pagination on numeric `id` (PK). Avoids OFFSET scans that hit the
// Postgres statement_timeout on large tables (e.g. mssql_asset_history ~200k rows).
async function fetchAllByKeyset<T extends { id: number }>(
  build: (lastId: number, limit: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  pageSize = 5000,
): Promise<T[]> {
  const out: T[] = [];
  let lastId = 0;
  for (let page = 0; page < 500; page++) {
    const res = await build(lastId, pageSize);
    if (res.error) throw new Error(res.error.message);
    const rows = (res.data as T[] | null) ?? [];
    if (rows.length === 0) break;
    out.push(...rows);
    lastId = rows[rows.length - 1].id;
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
  old_code: string | null;
  category: string | null;
  created_date: string | null;
  updated_date: string | null;
  status: string | null;
  asset_status: string | null;
  inform_detail: string | null;
  problem_category: string | null;
  problem_detail: string | null;
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
function dayStr(s: string | null | undefined): string {
  if (!s) return "";
  return s.length >= 10 ? s.slice(0, 10) : s;
}
function parseDay(s: string | null | undefined): number {
  const d = dayStr(s);
  if (!d) return NaN;
  const t = Date.parse(d + "T00:00:00Z");
  return Number.isFinite(t) ? t : NaN;
}
function daysBetween(aMs: number, bMs: number): number {
  return Math.floor((bMs - aMs) / 86_400_000);
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
          .from("mssql_asset_history")
          .select("old_code, category, created_date, updated_date, status, asset_status, inform_detail, problem_category, problem_detail")
          .in("category", ["Monitoring", "Claim"])
          .range(from, to),
      ),
      fetchAll<ClaimTicketRow>((from, to) =>
        supabaseAdmin
          .from("claim_tickets")
          .select("ref_number, asset_old_code, opened_at, status, informed_detail, payload")
          .range(from, to),
      ),
    ]);

    // Active assets only (exclude IsDeleted)
    const assetMap = new Map<
      string,
      { code: string; name: string; department: string; area: string; mediaType: string; project: string; zone: string }
    >();
    for (const r of assetsRaw) {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const del = p.IsDeleted;
      if (del === true || del === "true") continue;
      if (assetMap.has(r.old_code)) continue;
      assetMap.set(r.old_code, {
        code: r.old_code,
        name: r.name ?? "",
        department: r.department ?? "",
        area: r.area ?? "",
        mediaType: typeof p.MediaType === "string" ? (p.MediaType as string) : "",
        project: "",
        zone: typeof p.BKKUPC === "string" ? (p.BKKUPC as string) : (typeof p.BkkUpc === "string" ? (p.BkkUpc as string) : ""),
      });
    }

    const zoneSet = new Set(f.zones);
    const projSet = new Set(f.projects);
    const projDeptSet = departmentsForProjects(f.projects);
    const mtSet = new Set(f.mediaTypes);
    const codeQ = (f.oldCode || "").trim().toLowerCase();

    const fromDay = f.fromDate ? parseDay(f.fromDate) : -Infinity;
    const toDay = f.toDate ? parseDay(f.toDate) + 86_400_000 - 1 : Infinity;

    function matchAsset(a: { department: string; project: string; zone: string; mediaType: string; code: string }): boolean {
      if (codeQ && a.code.toLowerCase() !== codeQ) return false;
      if (projSet.size && !(projSet.has(a.project) || projDeptSet.has(a.department))) return false;
      if (zoneSet.size && !zoneSet.has(a.zone)) return false;
      if (mtSet.size && !mtSet.has(a.mediaType)) return false;
      return true;
    }

    const inScopeAssets = new Map<string, ReturnType<() => { code: string; name: string; department: string; area: string; mediaType: string; project: string; zone: string }>>();
    for (const a of assetMap.values()) {
      if (matchAsset(a)) inScopeAssets.set(a.code, a);
    }

    // Build per-asset Monitor + Claim history
    type MonEvent = { dateMs: number; dateStr: string; closedMs: number; closedStr: string; assetStatus: StatusKey };
    type ClaimEvent = {
      dateMs: number;
      dateStr: string;
      refNumber: string;
      informDetail: string;
      problemCategory: string;
      problemDetail: string;
      status: string;
    };
    const monByAsset = new Map<string, MonEvent[]>();
    const claimByAsset = new Map<string, ClaimEvent[]>();

    for (const h of histRaw) {
      if (!h.old_code || !inScopeAssets.has(h.old_code)) continue;
      if (h.category === "Monitoring") {
        const openStr = dayStr(h.created_date);
        const closedStr = dayStr(h.updated_date);
        const openMs = parseDay(openStr);
        const closedMs = parseDay(closedStr);
        if (!Number.isFinite(openMs) && !Number.isFinite(closedMs)) continue;
        const arr = monByAsset.get(h.old_code) ?? [];
        const status = normalizeStatus(h.asset_status);
        arr.push({
          dateMs: Number.isFinite(openMs) ? openMs : closedMs,
          dateStr: openStr || closedStr,
          closedMs: Number.isFinite(closedMs) ? closedMs : openMs,
          closedStr: closedStr || openStr,
          assetStatus: status,
        });
        monByAsset.set(h.old_code, arr);
      } else if (h.category === "Claim") {
        const openStr = dayStr(h.created_date);
        const d = parseDay(openStr);
        if (!Number.isFinite(d)) continue;
        const arr = claimByAsset.get(h.old_code) ?? [];
        arr.push({
          dateMs: d,
          dateStr: openStr,
          refNumber: "",
          informDetail: h.inform_detail ?? "",
          problemCategory: h.problem_category ?? "",
          problemDetail: h.problem_detail ?? "",
          status: h.status ?? "",
        });
        claimByAsset.set(h.old_code, arr);
      }
    }

    for (const arr of monByAsset.values()) arr.sort((a, b) => a.dateMs - b.dateMs);
    for (const arr of claimByAsset.values()) arr.sort((a, b) => a.dateMs - b.dateMs);

    const nowMs = Date.now();
    const yearAgoMs = nowMs - 365 * 86_400_000;

    // ---------- Per-asset inspection rows ----------
    type InspectionRow = {
      assetCode: string;
      department: string;
      project: string;
      pmCount: number;
      lastPmDate: string;
      daysSinceLastPm: number | null;
      avgIntervalDays: number | null;
      lastStatus: StatusKey;
      passedInLastYear: boolean;
    };
    const inspectionRows: InspectionRow[] = [];
    for (const a of inScopeAssets.values()) {
      const allMons = monByAsset.get(a.code) ?? [];
      // ผูกตัวกรองวันที่: นับเฉพาะ Monitor event ที่ตกในช่วงที่เลือก
      const mons = allMons.filter((m) => Number.isFinite(m.dateMs) && m.dateMs >= fromDay && m.dateMs <= toDay);
      let avg: number | null = null;
      if (mons.length >= 2) {
        let sum = 0;
        for (let i = 1; i < mons.length; i++) sum += (mons[i].dateMs - mons[i - 1].dateMs) / 86_400_000;
        avg = Math.round(sum / (mons.length - 1));
      }
      const last = mons[mons.length - 1];
      // "ผ่านในรอบปี" ยังคงดูจาก lifetime เพื่อใช้กับ KPI 12 เดือนย้อนหลัง
      const passedInLastYear = allMons.some((m) => m.assetStatus === "Pass" && m.dateMs >= yearAgoMs);
      inspectionRows.push({
        assetCode: a.code,
        department: a.department,
        project: a.project,
        pmCount: mons.length,
        lastPmDate: last?.dateStr ?? "",
        daysSinceLastPm: last ? Math.floor((nowMs - last.dateMs) / 86_400_000) : null,
        avgIntervalDays: avg,
        lastStatus: last?.assetStatus ?? "Pending",
        passedInLastYear,
      });
    }

    // ---------- Status counts (event-based, within selected period) ----------
    // นับ "เหตุการณ์ตรวจ" (Monitor events) ที่ opened_at อยู่ในช่วงตัวกรอง
    // แล้วจำแนกตาม payload.assetStatus → Pending/Pass/Fail/Skip
    const statusCounts: Record<StatusKey, number> = { Pending: 0, Pass: 0, Fail: 0, Skip: 0 };
    const deptAgg = new Map<string, { dept: string; Pending: number; Pass: number; Fail: number; Skip: number }>();
    for (const [code, mons] of monByAsset) {
      const a = inScopeAssets.get(code);
      if (!a) continue;
      const d = a.department || "(ไม่ระบุ)";
      const v = deptAgg.get(d) ?? { dept: d, Pending: 0, Pass: 0, Fail: 0, Skip: 0 };
      for (const m of mons) {
        if (!Number.isFinite(m.dateMs)) continue;
        if (m.dateMs < fromDay || m.dateMs > toDay) continue;
        statusCounts[m.assetStatus]++;
        v[m.assetStatus]++;
      }
      deptAgg.set(d, v);
    }
    const statusPie = STATUSES.map((s) => ({
      name:
        s === "Pending" ? "ยังไม่ได้ตรวจ (Pending)"
          : s === "Pass" ? "ตรวจผ่าน (Pass)"
            : s === "Fail" ? "ตรวจไม่ผ่าน (Fail)"
              : "ยกเลิกการตรวจ (Skip)",
      key: s,
      value: statusCounts[s],
    }));

    const byDepartment = Array.from(deptAgg.values()).sort(
      (a, b) => b.Pending + b.Pass + b.Fail + b.Skip - (a.Pending + a.Pass + a.Fail + a.Skip),
    );

    // ---------- PM → Claim pairs (closed Monitor → next Claim) ----------
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
      status: string;
      assetStatus: string;
    };
    const pairs: PairRow[] = [];
    const earlyFailSymptoms: string[] = [];
    for (const [code, mons] of monByAsset) {
      const a = inScopeAssets.get(code);
      if (!a) continue;
      const claims = claimByAsset.get(code) ?? [];
      if (claims.length === 0) continue;
      for (const m of mons) {
        const base = Number.isFinite(m.closedMs) ? m.closedMs : m.dateMs;
        if (!Number.isFinite(base)) continue;
        if (base < fromDay || base > toDay) continue;
        const next = claims.find((c) => c.dateMs >= base);
        if (!next) continue;
        const days = daysBetween(base, next.dateMs);
        if (days < 0) continue;
        pairs.push({
          assetCode: code,
          department: a.department,
          pmDate: m.closedStr || m.dateStr,
          claimDate: next.dateStr,
          claimRef: next.refNumber,
          days,
          problemCategory: next.problemCategory || "(ไม่ระบุ)",
          problemDetail: next.problemDetail || "(ไม่ระบุ)",
          informDetail: next.informDetail || "(ไม่ระบุ)",
          status: next.status || "",
          assetStatus: m.assetStatus || "",
        });
        if (days <= 7) {
          const sym = next.informDetail || next.problemDetail || "";
          if (sym) earlyFailSymptoms.push(sym);
        }
      }
    }

    const agingMap = new Map<string, number>();
    for (const b of BUCKETS) agingMap.set(b.key, 0);
    for (const p of pairs) {
      const k = bucketOf(p.days);
      if (k) agingMap.set(k, (agingMap.get(k) ?? 0) + 1);
    }
    const aging = BUCKETS.map((b) => ({ bucket: b.key, count: agingMap.get(b.key) ?? 0 }));

    function topN(arr: string[], n: number) {
      const m = new Map<string, number>();
      for (const v of arr) if (v && v !== "(ไม่ระบุ)") m.set(v, (m.get(v) ?? 0) + 1);
      return Array.from(m.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, n);
    }
    const earlySymptoms = topN(earlyFailSymptoms, 8);
    // Top 10 symptoms from early-fail (≤7 days) pairs, in selected period
    const topSymptoms = topN(earlyFailSymptoms, 10);

    // ---------- Tickets (claim_tickets) ----------
    type TicketRow = {
      assetCode: string;
      department: string;
      refNumber: string;
      createdDate: string;
      updatedDate: string;
      closedDate: string;
      status: string;
      pending: boolean;
      lastInspectStatus: StatusKey;
    };
    const inspectionByCode = new Map(inspectionRows.map((r) => [r.assetCode, r]));
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
      const cMs = parseDay(created);
      if (Number.isFinite(cMs) && (cMs < fromDay || cMs > toDay)) continue;
      ticketRows.push({
        assetCode: code,
        department: a.department,
        refNumber: t.ref_number,
        createdDate: created,
        updatedDate: updated,
        closedDate,
        status,
        pending: !!created && !!updated && created === updated,
        lastInspectStatus: inspectionByCode.get(code)?.lastStatus ?? "Pending",
      });
    }
    ticketRows.sort((a, b) => (b.createdDate || "").localeCompare(a.createdDate || ""));

    // ---------- KPIs ----------
    const totalAssets = inScopeAssets.size;
    const neverPm12m = inspectionRows.filter((r) => !r.passedInLastYear).length;
    const earlyFail7 = pairs.filter((p) => p.days >= 0 && p.days <= 7).length;
    // ตั๋วเปิดแล้วรอตรวจ: Monitor events ในช่วง ที่ assetStatus = Pending
    const pendingInspect = statusCounts.Pending;

    const kpi = {
      totalAssets,
      neverPm: neverPm12m,
      earlyFail7,
      pendingTickets: pendingInspect,
    };

    // ---------- Filter options ----------
    const optZone = new Set<string>();
    const optMedia = new Set<string>();
    for (const a of assetMap.values()) {
      if (a.zone) optZone.add(a.zone);
      if (a.mediaType) optMedia.add(a.mediaType);
    }
    const filters = {
      departments: [] as string[],
      zones: Array.from(optZone).sort(),
      projects: Object.keys(PROJECT_TO_DEPARTMENTS).sort(),
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
      statusCounts,
    };
  });

// Fast filter-options endpoint (assets-only, small payload, cached)
// Returns dropdown lists + per-asset metadata for filter interlock and
// asset-code typeahead on the Monitoring page.
export const getMonitoringFilterOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    type Row = { old_code: string; department: string | null; payload: Record<string, unknown> | null };
    const rows = await fetchAll<Row>((from, to) =>
      supabaseAdmin.from("assets").select("old_code, department, payload").range(from, to),
    );
    const zones = new Set<string>();
    const mediaTypes = new Set<string>();
    const projects = new Set<string>();
    const assetMeta: Array<{
      code: string;
      department: string | null;
      project: string | null;
      mediaType: string | null;
      zones: string[];
      projects: string[];
    }> = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const p = r.payload ?? {};
      if (p.IsDeleted === true || p.IsDeleted === "true") continue;
      if (seen.has(r.old_code)) continue;
      seen.add(r.old_code);
      const z = (p.BKKUPC ?? p.BkkUpc) as unknown;
      const zoneRaw = typeof z === "string" && z ? z : null;
      if (zoneRaw) zones.add(zoneRaw);
      const m = p.MediaType as unknown;
      const mt = typeof m === "string" && m ? m : null;
      if (mt) mediaTypes.add(mt);
      const proj = ((): string | null => {
        for (const [pj, depts] of Object.entries(PROJECT_TO_DEPARTMENTS)) {
          if (r.department && depts.includes(r.department)) return pj;
        }
        return null;
      })();
      if (proj) projects.add(proj);
      assetMeta.push({
        code: r.old_code,
        department: r.department,
        project: proj,
        mediaType: mt,
        zones: zoneRaw ? [zoneRaw] : [],
        projects: proj ? [proj] : [],
      });
    }
    assetMeta.sort((a, b) => a.code.localeCompare(b.code));
    return {
      departments: [] as string[],
      zones: Array.from(zones).sort(),
      projects: Array.from(projects).sort(),
      mediaTypes: Array.from(mediaTypes).sort(),
      assetCodes: assetMeta.map((a) => a.code),
      assetMeta,
    };
  });
