import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { departmentsForProjects, projectForDepartment } from "@/lib/project-department-map";
import { buildClaimText, classifyText, type DiagramMapping } from "@/lib/rca-classifier";

// ───────────────── Schemas ─────────────────
const filtersSchema = z.object({
  departments: z.array(z.string()).optional().default([]),
  zones: z.array(z.string()).optional().default([]),
  projects: z.array(z.string()).optional().default([]),
  mediaTypes: z.array(z.string()).optional().default([]),
  fromDate: z.string().optional().nullable(),
  toDate: z.string().optional().nullable(),
  assetCode: z.string().optional().nullable(),
});
export type RcaFilters = z.infer<typeof filtersSchema>;

// ───────────────── Helpers ─────────────────
type HistRow = {
  id: string;
  old_code: string | null;
  category: string | null;
  created_date: string | null;
  updated_date: string | null;
  status: string | null;
  asset_status: string | null;
  inform_detail: string | null;
  inform_position: string | null;
  problem_category: string | null;
  problem_detail: string | null;
  problem_equipment: string | null;
  solution_category: string | null;
  solution_detail: string | null;
  response_time: number | null;
  resolve_time: number | null;
  total_turnaround_time: number | null;
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

const HIST_COLS =
  "id, old_code, category, created_date, updated_date, status, asset_status, inform_position, inform_detail, problem_category, problem_detail, problem_equipment, solution_category, solution_detail, response_time, resolve_time, total_turnaround_time, project, bkk_upc, media_type";

async function fetchHistoryKeyset(
  category: string,
  opts: { fromMs?: number; toMs?: number; oldCodes?: string[] },
  pageSize = 10000,
): Promise<HistRow[]> {
  const codes = opts.oldCodes?.filter(Boolean);
  if (codes && codes.length === 0) return [];
  const out: HistRow[] = [];
  let last: string | null = null;
  for (let page = 0; page < 500; page++) {
    let q = supabaseAdmin
      .from("mssql_asset_history")
      .select(HIST_COLS)
      .eq("category", category)
      .not("created_date", "is", null)
      .order("created_date", { ascending: true })
      .order("id", { ascending: true })
      .limit(pageSize);
    if (Number.isFinite(opts.fromMs)) q = q.gte("created_date", new Date(opts.fromMs!).toISOString());
    if (Number.isFinite(opts.toMs)) q = q.lte("created_date", new Date(opts.toMs!).toISOString());
    if (codes) q = q.in("old_code", codes);
    if (last) q = q.gt("created_date", last);
    const res = await q;
    if (res.error) throw new Error(res.error.message);
    const rows = ((res.data as unknown) as HistRow[] | null) ?? [];
    if (rows.length === 0) break;
    out.push(...rows);
    last = rows[rows.length - 1].created_date;
    if (rows.length < pageSize) break;
  }
  return out;
}

async function fetchHistoryScoped(
  category: string,
  opts: { fromMs?: number; toMs?: number; oldCodes?: string[] },
): Promise<HistRow[]> {
  const codes = opts.oldCodes;
  if (!codes || codes.length <= 200) return fetchHistoryKeyset(category, opts);
  const out: HistRow[] = [];
  for (let i = 0; i < codes.length; i += 200) {
    out.push(...(await fetchHistoryKeyset(category, { ...opts, oldCodes: codes.slice(i, i + 200) })));
  }
  return out;
}

async function loadAssets(): Promise<{
  assetMap: Map<string, AssetLite>;
  deletedSet: Set<string>;
}> {
  const raw = await fetchAll<{
    old_code: string;
    name: string | null;
    department: string | null;
    area: string | null;
    payload: Record<string, unknown> | null;
  }>((from, to) => supabaseAdmin.from("assets").select("old_code, name, department, area, payload").range(from, to));
  const active = new Set<string>();
  for (const r of raw) {
    const p = r.payload ?? null;
    const del = p && typeof p === "object" ? (p as Record<string, unknown>).IsDeleted : null;
    if (del !== true && del !== "true") active.add(r.old_code);
  }
  const map = new Map<string, AssetLite>();
  for (const r of raw) {
    if (!active.has(r.old_code) || map.has(r.old_code)) continue;
    const p = (r.payload ?? {}) as Record<string, unknown>;
    map.set(r.old_code, {
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
  const deleted = new Set<string>();
  for (const r of raw) if (!active.has(r.old_code)) deleted.add(r.old_code);
  return { assetMap: map, deletedSet: deleted };
}

async function loadMappings(): Promise<DiagramMapping[]> {
  const { data, error } = await supabaseAdmin
    .from("diagram_mappings")
    .select("category, label, keywords, enabled, sort_order")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => ({
    category: d.category as string,
    label: d.label as string,
    keywords: (d.keywords as string[] | null) ?? [],
    enabled: d.enabled as boolean | null,
  }));
}

function buildScopeFilter(f: RcaFilters, assetMap: Map<string, AssetLite>, deletedSet: Set<string>) {
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
  function inScope(h: HistRow): boolean {
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
  function inFilter(h: HistRow): boolean {
    if (!inScope(h)) return false;
    const ts = h.created_date ? new Date(h.created_date).getTime() : NaN;
    if (Number.isFinite(ts) && (ts < fromTs || ts > toTs)) return false;
    return true;
  }
  const scopedCodes: string[] = [];
  for (const a of assetMap.values()) {
    if (depSet.size && !depSet.has(a.department ?? "")) continue;
    if (projSet.size && !(a.department && projDeptSet.has(a.department))) continue;
    if (mtSet.size && !mtSet.has(a.asset_media_type ?? "")) continue;
    if (zoneSet.size && !zoneSet.has(a.zone ?? "")) continue;
    if (assetCodeQ && a.old_code.toLowerCase() !== assetCodeQ) continue;
    scopedCodes.push(a.old_code);
  }
  return { inScope, inFilter, scopedCodes, fromMs: Number.isFinite(fromTs) ? fromTs : undefined, toMs: Number.isFinite(toTs) ? toTs : undefined, assetCodeQ };
}

function paretoOf(items: string[], topN = 12): { label: string; count: number; cumulativePct: number }[] {
  const m = new Map<string, number>();
  for (const v of items) {
    const k = (v || "").trim() || "(ไม่ระบุ)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  const sorted = Array.from(m.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  const total = sorted.reduce((s, x) => s + x.count, 0) || 1;
  const slice = sorted.slice(0, topN);
  let acc = 0;
  return slice.map((x) => {
    acc += x.count;
    return { ...x, cumulativePct: Math.round((acc / total) * 1000) / 10 };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 1. PORTFOLIO TAB
// ═══════════════════════════════════════════════════════════════════════
export const getRcaPortfolio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => filtersSchema.parse(i ?? {}))
  .handler(async ({ data: f }) => {
    const { assetMap, deletedSet } = await loadAssets();
    const scope = buildScopeFilter(f, assetMap, deletedSet);

    const claimsRaw = await fetchHistoryScoped("Claim", {
      fromMs: scope.fromMs,
      toMs: scope.toMs,
      oldCodes: scope.scopedCodes.length <= 1500 || scope.assetCodeQ ? scope.scopedCodes : undefined,
    });
    const claims = claimsRaw.filter(scope.inFilter);

    const totalClaims = claims.length;
    const uniqueAssets = new Set(claims.map((c) => c.old_code).filter(Boolean) as string[]).size;
    let resolveSum = 0, resolveN = 0;
    for (const c of claims) {
      const v = c.resolve_time ?? c.total_turnaround_time;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        resolveSum += v;
        resolveN++;
      }
    }
    const avgResolveHrs = resolveN > 0 ? Math.round((resolveSum / resolveN) * 10) / 10 : null;

    const claimsByAsset = new Map<string, HistRow[]>();
    for (const c of claims) {
      const k = c.old_code;
      if (!k) continue;
      const arr = claimsByAsset.get(k) ?? [];
      arr.push(c);
      claimsByAsset.set(k, arr);
    }
    let repeatAssets = 0;
    const mtbfByAsset = new Map<string, number>();
    for (const [code, rows] of claimsByAsset) {
      if (rows.length >= 3) repeatAssets++;
      if (rows.length >= 2) {
        const ts = rows
          .map((r) => (r.created_date ? new Date(r.created_date).getTime() : NaN))
          .filter((x) => Number.isFinite(x))
          .sort((a, b) => a - b);
        if (ts.length >= 2) {
          let s = 0;
          for (let i = 1; i < ts.length; i++) s += (ts[i] - ts[i - 1]) / 86_400_000;
          mtbfByAsset.set(code, Math.round((s / (ts.length - 1)) * 10) / 10);
        }
      }
    }
    const repeatRatePct = uniqueAssets > 0 ? Math.round((repeatAssets / uniqueAssets) * 1000) / 10 : 0;

    const summary = { totalClaims, uniqueAssets, avgResolveHrs, repeatRatePct };

    const paretoProblem = paretoOf(claims.map((c) => c.problem_category ?? ""), 12);
    const paretoEquipment = paretoOf(claims.map((c) => c.problem_equipment ?? ""), 12);
    const paretoInformPosition = paretoOf(claims.map((c) => c.inform_position ?? ""), 12);
    const paretoInformDetail = paretoOf(claims.map((c) => c.inform_detail ?? ""), 12);

    // Problem → Solution matrix
    const mxMap = new Map<string, number>();
    const pSet = new Set<string>();
    const sSet = new Set<string>();
    for (const c of claims) {
      const p = (c.problem_category || "(ไม่ระบุ)").trim();
      const s = (c.solution_category || "(ไม่ระบุ)").trim();
      pSet.add(p);
      sSet.add(s);
      const k = `${p}|||${s}`;
      mxMap.set(k, (mxMap.get(k) ?? 0) + 1);
    }
    const matrix = Array.from(mxMap.entries()).map(([k, count]) => {
      const [problemCat, solutionCat] = k.split("|||");
      return { problemCat, solutionCat, count };
    });

    // Inform Detail → Solution Detail matrix
    const idMap = new Map<string, number>();
    for (const c of claims) {
      const p = (c.inform_detail || "(ไม่ระบุ)").trim();
      const s = (c.solution_detail || "(ไม่ระบุ)").trim();
      const k = `${p}|||${s}`;
      idMap.set(k, (idMap.get(k) ?? 0) + 1);
    }
    const informMatrix = Array.from(idMap.entries()).map(([k, count]) => {
      const [problemCat, solutionCat] = k.split("|||");
      return { problemCat, solutionCat, count };
    });

    // Top offenders
    const offenders = Array.from(claimsByAsset.entries())
      .map(([code, rows]) => {
        const a = assetMap.get(code);
        const sym = paretoOf(rows.map((r) => r.problem_equipment ?? ""), 1)[0]?.label ?? "(ไม่ระบุ)";
        return {
          oldCode: code,
          assetName: a?.name ?? "",
          project: rows[0]?.project ?? "",
          zone: rows[0]?.bkk_upc ?? a?.zone ?? "",
          claims: rows.length,
          mtbfDays: mtbfByAsset.get(code) ?? null,
          topSymptom: sym,
        };
      })
      .sort((a, b) => b.claims - a.claims)
      .slice(0, 15);

    return { summary, paretoProblem, paretoEquipment, paretoInformPosition, paretoInformDetail, matrix, informMatrix, problemCats: Array.from(pSet).sort(), solutionCats: Array.from(sSet).sort(), topOffenders: offenders };
  });

// ═══════════════════════════════════════════════════════════════════════
// 2. PER-ASSET TAB
// ═══════════════════════════════════════════════════════════════════════
const assetSchema = z.object({ oldCode: z.string().min(1), windowDays: z.number().int().min(1).max(180).optional().default(14) });

export const getRcaAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => assetSchema.parse(i ?? {}))
  .handler(async ({ data }) => {
    const code = data.oldCode.trim();
    const { assetMap } = await loadAssets();
    const a = assetMap.get(code) ?? null;

    const [pmMedia, pmNonMedia, mon, claims] = await Promise.all([
      fetchHistoryKeyset("PM (Media)", { oldCodes: [code] }),
      fetchHistoryKeyset("PM (non Media)", { oldCodes: [code] }),
      fetchHistoryKeyset("Monitoring", { oldCodes: [code] }),
      fetchHistoryKeyset("Claim", { oldCodes: [code] }),
    ]);
    const pm = [...pmMedia, ...pmNonMedia];

    // Timeline events
    type Evt = {
      kind: "PM" | "Monitoring" | "Claim";
      date: string;
      status: string;
      problem: string;
      equipment: string;
      solution: string;
      resolveHrs: number | null;
    };
    const events: Evt[] = [];
    for (const p of pm) {
      const d = p.updated_date ?? p.created_date;
      if (!d) continue;
      events.push({ kind: "PM", date: d, status: p.asset_status ?? "", problem: "", equipment: "", solution: "", resolveHrs: null });
    }
    for (const p of mon) {
      const d = p.updated_date ?? p.created_date;
      if (!d) continue;
      events.push({ kind: "Monitoring", date: d, status: p.asset_status ?? "", problem: "", equipment: "", solution: "", resolveHrs: null });
    }
    for (const p of claims) {
      const d = p.created_date;
      if (!d) continue;
      events.push({
        kind: "Claim",
        date: d,
        status: p.status ?? "",
        problem: p.problem_category ?? "",
        equipment: p.problem_equipment ?? "",
        solution: p.solution_category ?? "",
        resolveHrs: typeof p.resolve_time === "number" ? p.resolve_time : null,
      });
    }
    events.sort((a, b) => a.date.localeCompare(b.date));

    // KPI
    const claimTs = claims
      .map((c) => (c.created_date ? new Date(c.created_date).getTime() : NaN))
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => a - b);
    let mtbfDays: number | null = null;
    if (claimTs.length >= 2) {
      let s = 0;
      for (let i = 1; i < claimTs.length; i++) s += (claimTs[i] - claimTs[i - 1]) / 86_400_000;
      mtbfDays = Math.round((s / (claimTs.length - 1)) * 10) / 10;
    }
    let resolveSum = 0, resolveN = 0;
    for (const c of claims) {
      const v = c.resolve_time ?? c.total_turnaround_time;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        resolveSum += v;
        resolveN++;
      }
    }
    const avgResolveHrs = resolveN > 0 ? Math.round((resolveSum / resolveN) * 10) / 10 : null;
    const lastClaimTs = claimTs.length ? claimTs[claimTs.length - 1] : null;
    const daysSinceLast = lastClaimTs ? Math.floor((Date.now() - lastClaimTs) / 86_400_000) : null;

    const kpi = { totalClaims: claims.length, mtbfDays, avgResolveHrs, daysSinceLast, totalPm: pm.length, totalMonitoring: mon.length };

    // Fingerprint
    const fingerprint = {
      problem: paretoOf(claims.map((c) => c.problem_category ?? ""), 8),
      equipment: paretoOf(claims.map((c) => c.problem_equipment ?? ""), 8),
      solution: paretoOf(claims.map((c) => c.solution_category ?? ""), 8),
    };

    // Recurrence — same equipment ≥2 times within 30 days
    type Recur = { equipment: string; count: number; firstDate: string; lastDate: string };
    const byEquip = new Map<string, { ts: number; date: string }[]>();
    for (const c of claims) {
      const eq = (c.problem_equipment || "").trim();
      if (!eq || !c.created_date) continue;
      const ts = new Date(c.created_date).getTime();
      if (!Number.isFinite(ts)) continue;
      const arr = byEquip.get(eq) ?? [];
      arr.push({ ts, date: c.created_date.slice(0, 10) });
      byEquip.set(eq, arr);
    }
    const recurrences: Recur[] = [];
    for (const [eq, arr] of byEquip) {
      arr.sort((a, b) => a.ts - b.ts);
      // find any window of 30 days containing ≥2 occurrences
      let best = 0, bestStart = 0, bestEnd = 0;
      let j = 0;
      for (let i = 0; i < arr.length; i++) {
        while (arr[i].ts - arr[j].ts > 30 * 86_400_000) j++;
        const n = i - j + 1;
        if (n > best) {
          best = n;
          bestStart = j;
          bestEnd = i;
        }
      }
      if (best >= 2) {
        recurrences.push({ equipment: eq, count: best, firstDate: arr[bestStart].date, lastDate: arr[bestEnd].date });
      }
    }
    recurrences.sort((a, b) => b.count - a.count);

    // PM Effectiveness: PM Pass → next Claim within windowDays
    type PmFail = { pmDate: string; claimDate: string; days: number; problem: string; equipment: string };
    const pmFails: PmFail[] = [];
    const passPmTs = pm
      .filter((p) => (p.asset_status ?? "").toLowerCase() === "pass")
      .map((p) => ({ ts: new Date(p.updated_date ?? p.created_date ?? 0).getTime(), date: (p.updated_date ?? p.created_date ?? "").slice(0, 10) }))
      .filter((x) => Number.isFinite(x.ts))
      .sort((a, b) => a.ts - b.ts);
    const claimEvents = claims
      .map((c) => ({
        ts: new Date(c.created_date ?? 0).getTime(),
        date: (c.created_date ?? "").slice(0, 10),
        problem: c.problem_category ?? "",
        equipment: c.problem_equipment ?? "",
      }))
      .filter((x) => Number.isFinite(x.ts))
      .sort((a, b) => a.ts - b.ts);
    const windowMs = data.windowDays * 86_400_000;
    for (const p of passPmTs) {
      const c = claimEvents.find((x) => x.ts >= p.ts && x.ts - p.ts <= windowMs);
      if (c) {
        pmFails.push({
          pmDate: p.date,
          claimDate: c.date,
          days: Math.floor((c.ts - p.ts) / 86_400_000),
          problem: c.problem,
          equipment: c.equipment,
        });
      }
    }
    const pmEffective = {
      passCount: passPmTs.length,
      failedAfterCount: pmFails.length,
      successRate: passPmTs.length ? Math.round((1 - pmFails.length / passPmTs.length) * 1000) / 10 : null,
      windowDays: data.windowDays,
      fails: pmFails,
    };

    // History rows for table
    const history = claims
      .map((c) => ({
        createdDate: c.created_date ?? "",
        updatedDate: c.updated_date ?? "",
        informPosition: (c as { inform_position?: string | null }).inform_position ?? "",
        informDetail: c.inform_detail ?? "",
        problemCategory: c.problem_category ?? "",
        problemEquipment: c.problem_equipment ?? "",
        problemDetail: c.problem_detail ?? "",
        solutionCategory: c.solution_category ?? "",
        solutionDetail: c.solution_detail ?? "",
        responseTime: c.response_time ?? null,
        resolveTime: c.resolve_time ?? null,
        totalTurnaroundTime: c.total_turnaround_time ?? null,
        assetStatus: c.asset_status ?? "",
        // legacy
        date: (c.created_date ?? "").slice(0, 10),
        status: c.status ?? "",
        resolveHrs: c.resolve_time ?? null,
      }))
      .sort((a, b) => b.createdDate.localeCompare(a.createdDate));

    // Avg repair time KPIs (DB already stores values in days)
    const avgOf = (arr: (number | null)[]) => {
      let s = 0, n = 0;
      for (const v of arr) if (typeof v === "number" && Number.isFinite(v) && v > 0) { s += v; n++; }
      return n > 0 ? Math.round((s / n) * 100) / 100 : null;
    };
    const sumOf = (arr: (number | null)[]) => {
      let s = 0, n = 0;
      for (const v of arr) if (typeof v === "number" && Number.isFinite(v) && v > 0) { s += v; n++; }
      return { sum: n > 0 ? Math.round(s * 100) / 100 : null, count: n };
    };
    const totalTurnaround = sumOf(claims.map((c) => c.total_turnaround_time));
    const repairTime = {
      avgResponseDays: avgOf(claims.map((c) => c.response_time)),
      avgResolveDays: avgOf(claims.map((c) => c.resolve_time)),
      avgTotalTurnaroundDays: avgOf(claims.map((c) => c.total_turnaround_time)),
      totalDowntimeMins: totalTurnaround.sum,
      downtimeTickets: totalTurnaround.count,
    };


    return {
      asset: a
        ? {
            oldCode: a.old_code,
            name: a.name ?? "",
            department: a.department ?? "",
            area: a.area ?? "",
            zone: a.zone ?? "",
            mediaType: a.asset_media_type ?? "",
            found: true as const,
          }
        : { oldCode: code, name: "", department: "", area: "", zone: "", mediaType: "", found: false as const },
      kpi,
      events,
      fingerprint,
      recurrences: recurrences.slice(0, 20),
      pmEffective,
      repairTime,
      history,
    };
  });

// ═══════════════════════════════════════════════════════════════════════
// 3. DIAGRAM MAPPING TAB
// ═══════════════════════════════════════════════════════════════════════
export const getRcaMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => filtersSchema.parse(i ?? {}))
  .handler(async ({ data: f }) => {
    const { assetMap, deletedSet } = await loadAssets();
    const scope = buildScopeFilter(f, assetMap, deletedSet);
    const mappings = await loadMappings();

    const claimsRaw = await fetchHistoryScoped("Claim", {
      fromMs: scope.fromMs,
      toMs: scope.toMs,
      oldCodes: scope.scopedCodes.length <= 1500 || scope.assetCodeQ ? scope.scopedCodes : undefined,
    });
    const claims = claimsRaw.filter(scope.inFilter);

    // Classify each claim
    type CatStat = {
      category: string;
      label: string;
      count: number;
      resolveSum: number;
      resolveN: number;
      solutionCounter: Map<string, number>;
      assets: Set<string>;
      claimTs: Map<string, number[]>;
    };
    const statsMap = new Map<string, CatStat>();
    function ensure(cat: string, label: string): CatStat {
      let s = statsMap.get(cat);
      if (!s) {
        s = { category: cat, label, count: 0, resolveSum: 0, resolveN: 0, solutionCounter: new Map(), assets: new Set(), claimTs: new Map() };
        statsMap.set(cat, s);
      }
      return s;
    }
    const unmappedPhrases = new Map<string, number>();
    let unmappedCount = 0;
    for (const c of claims) {
      const text = buildClaimText(c);
      const r = classifyText(text, mappings);
      const cat = r?.category ?? "_unmapped";
      const label = r?.label ?? "ไม่เข้าหมวด (Unmapped)";
      const s = ensure(cat, label);
      s.count++;
      const v = c.resolve_time ?? c.total_turnaround_time;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        s.resolveSum += v;
        s.resolveN++;
      }
      const sol = (c.solution_category || "(ไม่ระบุ)").trim();
      s.solutionCounter.set(sol, (s.solutionCounter.get(sol) ?? 0) + 1);
      if (c.old_code) s.assets.add(c.old_code);
      if (c.old_code && c.created_date) {
        const ts = new Date(c.created_date).getTime();
        if (Number.isFinite(ts)) {
          const arr = s.claimTs.get(c.old_code) ?? [];
          arr.push(ts);
          s.claimTs.set(c.old_code, arr);
        }
      }
      if (cat === "_unmapped") {
        unmappedCount++;
        const phrase = (c.problem_equipment || c.problem_category || c.problem_detail || "(ว่าง)").trim().slice(0, 80);
        unmappedPhrases.set(phrase, (unmappedPhrases.get(phrase) ?? 0) + 1);
      }
    }

    const distribution = Array.from(statsMap.values()).map((s) => ({
      category: s.category,
      label: s.label,
      count: s.count,
    })).sort((a, b) => b.count - a.count);

    const perCategory = Array.from(statsMap.values()).map((s) => {
      const top = Array.from(s.solutionCounter.entries()).sort((a, b) => b[1] - a[1])[0];
      // MTBF per asset
      let mtbfSum = 0, mtbfN = 0;
      for (const arr of s.claimTs.values()) {
        if (arr.length < 2) continue;
        arr.sort((a, b) => a - b);
        for (let i = 1; i < arr.length; i++) {
          mtbfSum += (arr[i] - arr[i - 1]) / 86_400_000;
          mtbfN++;
        }
      }
      return {
        category: s.category,
        label: s.label,
        totalClaims: s.count,
        uniqueAssets: s.assets.size,
        avgResolveHrs: s.resolveN ? Math.round((s.resolveSum / s.resolveN) * 10) / 10 : null,
        mtbfDays: mtbfN ? Math.round((mtbfSum / mtbfN) * 10) / 10 : null,
        topSolution: top ? top[0] : "(ไม่ระบุ)",
      };
    }).sort((a, b) => b.totalClaims - a.totalClaims);

    const topUnmapped = Array.from(unmappedPhrases.entries())
      .map(([phrase, count]) => ({ phrase, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);

    const total = claims.length;
    const unmappedPct = total > 0 ? Math.round((unmappedCount / total) * 1000) / 10 : 0;

    return {
      total,
      unmappedCount,
      unmappedPct,
      distribution,
      perCategory,
      topUnmapped,
      mappings: mappings.map((m) => ({ category: m.category, label: m.label, keywordCount: m.keywords?.length ?? 0 })),
    };
  });
