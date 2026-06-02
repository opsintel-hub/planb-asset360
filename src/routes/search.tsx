import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Search, RefreshCw, MapPin, Building2, X, Plus, ChevronDown,
  Activity, AlertCircle, Wrench, Eye, Calendar as CalIcon, IdCard, CalendarClock, AlertTriangle, BarChart3,
} from "lucide-react";
import { BreakdownTab } from "@/components/breakdown-tab";
import { AnalyticsTab } from "@/components/analytics-tab";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { PageHeader, Badge, StatCard } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { autocompleteAssets, getAssetsComparison, getFilterOptions, getAssetProfile, getAssetsPmSchedule } from "@/lib/data.functions";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export const Route = createFileRoute("/search")({
  head: () => ({
    meta: [
      { title: "ค้นหาประวัติป้ายโฆษณา — Asset History 360" },
      { name: "description", content: "เปรียบเทียบประวัติ PM / Claim / Monitoring ของป้ายโฆษณาสูงสุด 5 ป้าย" },
    ],
  }),
  component: SearchPage,
});

const TABS = [
  { id: "Profile", label: "Profile", icon: IdCard },
  { id: "Monitor", label: "Monitoring", icon: Eye },
  { id: "Claim", label: "Claim", icon: AlertCircle },
  { id: "PM", label: "PM", icon: Wrench },
  { id: "PMSchedule", label: "PM Schedule", icon: CalendarClock },
  { id: "AssetHealth", label: "Asset Health", icon: Activity },
  { id: "Analytics", label: "Analytics", icon: BarChart3 },
  { id: "Breakdown", label: "Breakdown", icon: AlertTriangle },
] as const;
type TabId = typeof TABS[number]["id"];

// ============ PM Schedule shared types/helpers ============
type PmScheduleRow = {
  id: string;
  project: string | null;
  asset_old_code: string | null;
  ref_number: string | null;
  schedule_date: string | null;
  status: string | null;
  inform_position: string | null;
  asset_status: string | null;
  payload?: unknown;
};

type PmWorkStage = "pending" | "working" | "finished" | "approved" | "unknown";

/** ดึง AssetUpdateDate จาก payload (sync มาจาก Modern Corp) */
function getAssetUpdateDate(row: PmScheduleRow): string | null {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const v =
    p.AssetUpdateDate ?? p.assetUpdateDate ?? p.asset_update_date ?? p.UpdateDate ?? p.updateDate;
  return v ? String(v) : null;
}

/** จำแนกขั้นตอนงานจาก status / asset_status (รองรับทั้งไทย/อังกฤษ) */
function getPmWorkStage(row: PmScheduleRow): PmWorkStage {
  const s = `${row.status ?? ""} ${row.asset_status ?? ""}`.toLowerCase();
  if (/approved|pass|อนุมัติ|ผ่าน/.test(s)) return "approved";
  if (/finish|complete|done|closed|เสร็จ|รอตรวจ/.test(s)) return "finished";
  if (/working|in.?progress|กำลัง|ระหว่าง/.test(s)) return "working";
  if (/pending|wait|รอ/.test(s)) return "pending";
  return "unknown";
}

type PmSchedStatus =
  | { kind: "approved"; doneDate: string | null }
  | { kind: "finished"; doneDate: string | null } // ทำเสร็จแล้ว รอหัวหน้าตรวจ
  | { kind: "working"; scheduledFor: string | null; updatedAt: string | null }
  | { kind: "overdue"; days: number; scheduledFor: string }
  | { kind: "upcoming"; days: number; scheduledFor: string }
  | { kind: "pending"; scheduledFor: string | null }
  | { kind: "unknown" };

function computePmSchedStatus(row: PmScheduleRow): PmSchedStatus {
  const stage = getPmWorkStage(row);
  const updatedAt = getAssetUpdateDate(row);
  if (stage === "approved") return { kind: "approved", doneDate: updatedAt };
  if (stage === "finished") return { kind: "finished", doneDate: updatedAt };
  if (stage === "working") return { kind: "working", scheduledFor: row.schedule_date, updatedAt };

  if (!row.schedule_date) {
    return stage === "pending" ? { kind: "pending", scheduledFor: null } : { kind: "unknown" };
  }
  const sched = new Date(row.schedule_date).getTime();
  if (!Number.isFinite(sched)) return { kind: "unknown" };
  const days = Math.floor((Date.now() - sched) / 86_400_000);
  if (days > 0) return { kind: "overdue", days, scheduledFor: row.schedule_date };
  return { kind: "upcoming", days: -days, scheduledFor: row.schedule_date };
}



const RECENT_KEY = "asset-search-recent";
const MAX_SLOTS = 5;
const PALETTE = [
  "oklch(0.62 0.19 255)",
  "oklch(0.65 0.16 155)",
  "oklch(0.7 0.18 50)",
  "oklch(0.6 0.22 25)",
  "oklch(0.55 0.2 305)",
];
// สีเดียวกันทั้งระบบต่อ "ประเภทงาน" — PM / Claim / Monitor / PMSchedule (แผน)
const TYPE_COLOR: Record<"PM" | "Claim" | "Monitor" | "PMSchedule", string> = {
  PM: "oklch(0.62 0.19 255)",       // น้ำเงิน
  Claim: "oklch(0.6 0.22 25)",      // แดง
  Monitor: "oklch(0.65 0.16 155)",  // เขียว
  PMSchedule: "oklch(0.72 0.17 60)", // ส้ม/อำพัน — สำหรับ "แผน PM"
};
// รูปแบบเส้นแยกตามป้าย (สูงสุด 5 slots)


function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("th-TH");
}
/** แปลง "นาที" → "X วัน Y ชม. Z นาที" (DB เก็บค่าเวลาเป็นนาที) */
export function formatMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "—";
  const t = Math.round(totalMinutes);
  const d = Math.floor(t / 1440);
  const h = Math.floor((t % 1440) / 60);
  const m = t % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} วัน`);
  if (h) parts.push(`${h} ชม.`);
  if (m && d === 0) parts.push(`${m} นาที`);
  return parts.length ? parts.join(" ") : `${t} นาที`;
}

function durationLabel(
  status?: string | null,
  open?: string | null,
  close?: string | null,
  payload?: Record<string, unknown> | null,
) {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "finished") return "กำลังรอหัวหน้าตรวจ";
  if (s === "pending") return "รอจ่ายงานช่าง";
  if (s !== "approved") return "กำลังซ่อม";

  // Approved: ใช้ updatedDate - createdDate จาก payload ถ้ามี ไม่งั้น fallback closed/opened
  const p = (payload ?? {}) as Record<string, unknown>;
  const created = (p.createdDate ?? p.CreatedDate ?? open) as string | null | undefined;
  const updated = (p.updatedDate ?? p.UpdatedDate ?? close) as string | null | undefined;
  if (!created || !updated) return "—";
  const ms = new Date(updated).getTime() - new Date(created).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const days = ms / 86_400_000;
  if (days < 1) return "ภายใน 24 ชั่วโมง";
  return `${Math.floor(days)} วัน`;
}

// วันที่ที่ใช้จัดกลุ่มในกราฟ/Calendar/Matrix:
// - Claim: ใช้ "วันที่เปิด" (opened_at)
// - PM / Monitor: ใช้ "อัพเดทล่าสุด" (closed_at) ถ้ามี ไม่งั้น fallback opened_at
function eventDate(h: { type?: string; opened_at?: string | null; closed_at?: string | null }): string | null {
  if (h.type === "Claim") return h.opened_at ?? null;
  return h.closed_at ?? h.opened_at ?? null;
}

// ---------- Slot Combobox ----------
function SlotCombobox({
  value, onPick, onClear, color, department, region, mediaType,
}: { value: string | null; onPick: (code: string) => void; onClear: () => void; color: string;
     department?: string; region?: string; mediaType?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q, 250);
  const autoFn = useServerFn(autocompleteAssets);
  const { data: ac, isFetching } = useQuery({
    queryKey: ["autocomplete", debounced, department, region, mediaType],
    queryFn: () => autoFn({ data: { q: debounced, limit: 15, department: department || undefined, region: region || undefined, mediaType: mediaType || undefined } }),
    enabled: open,
    staleTime: 30_000,
  });
  const rows = ac?.rows ?? [];

  if (value) {
    return (
      <div className="flex items-center gap-2 h-10 px-3 rounded-lg border bg-background">
        <span className="size-2.5 rounded-full" style={{ background: color }} />
        <span className="font-mono text-sm">{value}</span>
        <button onClick={onClear} className="ml-auto text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 size-2.5 rounded-full" style={{ background: color }} />
      <Search className="size-4 absolute left-7 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="พิมพ์ Old Code หรือชื่อ..."
        className="w-full h-10 rounded-lg border bg-background pl-12 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border bg-popover shadow-lg max-h-80 overflow-auto">
          {isFetching ? (
            <div className="p-3 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-xs text-center text-muted-foreground">ไม่พบ — ลองพิมพ์คำอื่น</div>
          ) : (
            <ul className="py-1">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { onPick(r.old_code); setQ(""); setOpen(false); }}
                    className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2"
                  >
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted">{r.old_code}</span>
                    <span className="text-sm truncate flex-1">{r.name ?? "—"}</span>
                    {r.area && <span className="text-xs text-muted-foreground hidden sm:inline">{r.area}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Page ----------
function SearchPage() {
  const [slots, setSlots] = useState<(string | null)[]>([null]);
  const [tab, setTab] = useState<TabId>("Profile");
  const [from, setFrom] = useState("2026-01-01");
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [dept, setDept] = useState("");
  const [region, setRegion] = useState("");
  const [mediaType, setMediaType] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [healthSel, setHealthSel] = useState<{ PM: boolean; Claim: boolean; Monitor: boolean; PMSchedule: boolean }>({ PM: true, Claim: true, Monitor: true, PMSchedule: true });
  const [pmFreqDays, setPmFreqDays] = useState(30);
  const [debtMonths, setDebtMonths] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);

  const inFlightRef = useRef(false);

  useEffect(() => {
    try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); if (Array.isArray(r)) setRecent(r.slice(0, 8)); } catch { /* */ }
  }, []);

  const codes = slots.filter((s): s is string => !!s);
  const fromIso = from ? new Date(from + "T00:00:00").toISOString() : undefined;
  const toIso = to ? new Date(to + "T23:59:59").toISOString() : undefined;

  const cmpFn = useServerFn(getAssetsComparison);
  const filterFn = useServerFn(getFilterOptions);
  const profileFn = useServerFn(getAssetProfile);
  const { data: globalFilters } = useQuery({
    queryKey: ["global-filter-options"],
    queryFn: () => filterFn(),
    staleTime: 5 * 60_000,
  });
  const cmpTabForBackend: "PM" | "Claim" | "Monitor" | "AssetHealth" =
    tab === "Profile" || tab === "PMSchedule" ? "PM"
    : tab === "Breakdown" ? "Claim"
    : tab === "Analytics" ? "AssetHealth"
    : tab;
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["comparison", codes.join(","), cmpTabForBackend, fromIso, toIso, dept, region, mediaType],
    queryFn: () => cmpFn({
      data: {
        oldCodes: codes,
        tab: cmpTabForBackend,
        from: fromIso,
        to: toIso,
        department: dept || undefined,
        region: region || undefined,
        mediaType: mediaType || undefined,
      },
    }),
    enabled: codes.length > 0 && tab !== "Profile" && tab !== "PMSchedule",
  });
  const { data: profileData, isFetching: profileFetching } = useQuery({
    queryKey: ["asset-profile", codes.join(",")],
    queryFn: () => profileFn({ data: { oldCodes: codes } }),
    enabled: codes.length > 0 && tab === "Profile",
  });

  const pmScheduleFn = useServerFn(getAssetsPmSchedule);
  const { data: pmSchedData, isFetching: pmSchedFetching } = useQuery({
    queryKey: ["pm-schedule", codes.join(",")],
    queryFn: () => pmScheduleFn({ data: { oldCodes: codes } }),
    enabled: codes.length > 0 && (tab === "PMSchedule" || tab === "AssetHealth"),
  });

  // persist recent
  useEffect(() => {
    if (!codes.length) return;
    const merged = Array.from(new Set([...codes, ...recent])).slice(0, 8);
    if (merged.join(",") !== recent.join(",")) {
      setRecent(merged);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(merged)); } catch { /* */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes.join(",")]);

  function addSlot() {
    if (slots.length >= MAX_SLOTS) return;
    setSlots([...slots, null]);
  }
  function setSlotAt(i: number, val: string | null) {
    const next = [...slots]; next[i] = val; setSlots(next);
  }
  function removeSlot(i: number) {
    if (slots.length === 1) { setSlots([null]); return; }
    setSlots(slots.filter((_, idx) => idx !== i));
  }

  async function handleResync() {
    if (!codes.length || inFlightRef.current) return;
    inFlightRef.current = true;
    const p = cmpFn({ data: { oldCodes: codes, tab: cmpTabForBackend, from: fromIso, to: toIso, forceSync: true } }).then(() => refetch());
    p.finally(() => { inFlightRef.current = false; });
    toast.promise(p, { loading: "กำลังดึงประวัติจาก PlanB...", success: "ซิงค์ประวัติสำเร็จ", error: (e) => `ซิงค์ไม่สำเร็จ: ${e?.message ?? e}` });
  }

  const assets = data?.assets ?? [];
  const history = data?.history ?? [];
  // ใช้ option จาก global filters (ทุกป้ายในระบบ) แทนผลค้นหา เพื่อให้กรองก่อนค้นได้
  const filterOpts = globalFilters ?? { departments: [], regions: [], mediaTypes: [] };

  // colors per asset id
  const colorByAsset = useMemo(() => {
    const m = new Map<string, string>();
    assets.forEach((a, idx) => m.set(a.id, PALETTE[idx % PALETTE.length]));
    return m;
  }, [assets]);

  // ---------- Tab content ----------
  return (
    <div className="space-y-6">
      <PageHeader
        title="ค้นหาประวัติป้ายโฆษณา"
        subtitle="เปรียบเทียบประวัติงานสูงสุด 5 ป้าย — PM / Claim / Monitoring / Asset Health"
        actions={
          codes.length > 0 ? (
            <button
              onClick={handleResync}
              className="inline-flex items-center gap-2 text-sm h-9 px-3 rounded-lg border hover:bg-accent transition"
            >
              <RefreshCw className={cn("size-4", isFetching && "animate-spin")} /> ซิงค์ใหม่
            </button>
          ) : undefined
        }
      />

      {/* Filters (กรองก่อนค้น) */}
      <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)] space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-xs font-medium text-muted-foreground">
            🔍 กรองข้อมูลก่อนค้นหา — เลือก Department/พื้นที่/Media Type เพื่อให้ผลค้นหาในช่องด้านล่างแคบลง
          </div>
          {(dept || region || mediaType) && (
            <button
              onClick={() => { setDept(""); setRegion(""); setMediaType(""); }}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <X className="size-3" /> ล้างตัวกรอง
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Slicer label="Department" value={dept} onChange={setDept} options={filterOpts.departments} />
          <Slicer label="BKK / UPC" value={region} onChange={setRegion} options={filterOpts.regions} />
          <Slicer label="Media Type" value={mediaType} onChange={setMediaType} options={filterOpts.mediaTypes} />
          <div>
            <label className="text-xs font-medium text-muted-foreground">วันที่เริ่ม</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">วันที่สิ้นสุด</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm" />
          </div>
        </div>
      </div>

      {/* Slot selectors */}
      <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-card)] space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {slots.map((slot, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <SlotCombobox
                  value={slot}
                  color={PALETTE[i % PALETTE.length]}
                  department={dept}
                  region={region}
                  mediaType={mediaType}
                  onPick={(code) => setSlotAt(i, code)}
                  onClear={() => setSlotAt(i, null)}
                />
              </div>
              {slots.length > 1 && (
                <button onClick={() => removeSlot(i)} className="text-muted-foreground hover:text-destructive size-9 grid place-items-center rounded-lg border hover:bg-accent">
                  <X className="size-4" />
                </button>
              )}
            </div>
          ))}
          {slots.length < MAX_SLOTS && (
            <button
              onClick={addSlot}
              className="h-10 rounded-lg border-2 border-dashed text-sm text-muted-foreground hover:bg-accent hover:text-foreground inline-flex items-center justify-center gap-2"
            >
              <Plus className="size-4" /> เพิ่มป้าย (Add Comparison)
            </button>
          )}
        </div>

        {recent.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs pt-3 border-t">
            <span className="text-muted-foreground">ล่าสุด:</span>
            {recent.filter((r) => !codes.includes(r)).slice(0, 6).map((c) => (
              <button
                key={c}
                onClick={() => {
                  const emptyIdx = slots.findIndex((s) => !s);
                  if (emptyIdx >= 0) setSlotAt(emptyIdx, c);
                  else if (slots.length < MAX_SLOTS) setSlots([...slots, c]);
                }}
                className="font-mono px-2 py-1 rounded-md border bg-background hover:bg-accent"
              >{c}</button>
            ))}
          </div>
        )}
      </div>



      {/* Tabs */}
      <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden">
        <div className="flex border-b overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setPage(1); }}
              className={cn(
                "px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition inline-flex items-center gap-2",
                tab === t.id ? "border-primary text-primary bg-primary/5" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40",
              )}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-6">
          {codes.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              เริ่มต้นด้วยการเลือกป้ายโฆษณาจากช่องค้นหาด้านบน
            </div>
          ) : tab === "Profile" ? (
            profileFetching && !profileData ? (
              <div className="space-y-3"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
            ) : (
              <ProfileTab profiles={profileData?.profiles ?? []} />
            )
          ) : tab === "PMSchedule" ? (
            pmSchedFetching && !pmSchedData ? (
              <div className="space-y-3"><Skeleton className="h-64" /></div>
            ) : (
              <PmScheduleTab rows={pmSchedData?.rows ?? []} />
            )
          ) : isFetching && !data ? (
            <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
          ) : tab === "AssetHealth" ? (
            <AssetHealthTab
              assets={assets} history={history} colorByAsset={colorByAsset}
              sel={healthSel} onSel={setHealthSel}
              pmFreqDays={pmFreqDays} setPmFreqDays={setPmFreqDays}
              debtMonths={debtMonths} setDebtMonths={setDebtMonths}
              pmSchedRows={pmSchedData?.rows ?? []}
            />
          ) : tab === "Analytics" ? (
            <AnalyticsTab assets={assets} history={history} />
          ) : tab === "Breakdown" ? (
            <BreakdownTab assets={assets} history={history} />
          ) : (
            <RegularTab
              tab={tab as "PM" | "Claim" | "Monitor"} assets={assets} history={history} colorByAsset={colorByAsset}
              page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Slicer({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative mt-1">
        <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full h-9 rounded-md border bg-background pl-2 pr-7 text-sm appearance-none">
          <option value="">ทั้งหมด</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown className="size-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      </div>
    </div>
  );
}

// ============ Raw Data Table (shared by PM/Claim/Monitor) ============
const CORE_COLS_BASE: Array<{ key: string; label: string; sticky?: boolean }> = [
  { key: "__asset", label: "ป้าย", sticky: true },
  { key: "__opened", label: "วันที่เปิด" },
  { key: "__responseTime", label: "ระยะเวลาตอบรับ" },
  { key: "__resolveTime", label: "ระยะเวลาช่างซ่อม" },
  { key: "__totalTurnaround", label: "ระยะเวลาแก้ไขปัญหา" },
  { key: "__closed", label: "อัพเดทล่าสุด" },
  { key: "__duration", label: "ระยะเวลาแก้ปัญหาและตรวจสอบ" },
  { key: "__title", label: "รายการ" },
  { key: "__status", label: "สถานะ" },
];
const CLAIM_ONLY_COLS = new Set(["__responseTime", "__resolveTime", "__totalTurnaround"]);
function getCoreCols(tab: TabId) {
  return tab === "Claim" ? CORE_COLS_BASE : CORE_COLS_BASE.filter((c) => !CLAIM_ONLY_COLS.has(c.key));
}
// ซ่อนฟิลด์ที่แสดงเป็นคอลัมน์หลักแล้ว ออกจาก "ฟิลด์จากข้อมูล" เพื่อไม่ให้ซ้ำ
const EXCLUDED_PAYLOAD_KEYS = new Set([
  "status", "createdDate", "updatedDate",
  "responseTime", "resolveTime", "totalTurnaroundTime",
  "ResponseTime", "ResolveTime", "TotalTurnaroundTime",
]);

function RawDataTable({
  tab, history, total, pageRows, page, setPage, pageSize, setPageSize, totalPages, colorByAsset,
}: {
  tab: TabId;
  history: HistRow[]; total: number; pageRows: HistRow[];
  page: number; setPage: (n: number) => void;
  pageSize: number; setPageSize: (n: number) => void;
  totalPages: number;
  colorByAsset: Map<string, string>;
}) {
  const payloadKeys = useMemo(() => {
    const s = new Set<string>();
    for (const h of history) {
      const p = (h.payload ?? {}) as Record<string, unknown>;
      for (const k of Object.keys(p)) if (!EXCLUDED_PAYLOAD_KEYS.has(k)) s.add(k);
    }
    return Array.from(s).sort();
  }, [history]);

  const storageKey = `raw-hidden-cols:${tab}`;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setHidden(raw ? new Set(JSON.parse(raw)) : new Set());
    } catch { setHidden(new Set()); }
  }, [storageKey]);
  const toggleHide = (k: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      try { localStorage.setItem(storageKey, JSON.stringify(Array.from(next))); } catch { /* noop */ }
      return next;
    });
  };
  const resetHidden = () => {
    setHidden(new Set());
    try { localStorage.removeItem(storageKey); } catch { /* noop */ }
  };

  const coreCols = getCoreCols(tab);
  const visibleCore = coreCols.filter((c) => !hidden.has(c.key));
  const visiblePayload = payloadKeys.filter((k) => !hidden.has(`p:${k}`));
  const totalCols = visibleCore.length + visiblePayload.length;
  const [showColPanel, setShowColPanel] = useState(false);

  const renderCell = (h: HistRow, key: string) => {
    const p = (h.payload ?? {}) as Record<string, unknown>;
    switch (key) {
      case "__asset":
        return (
          <span className="inline-flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: colorByAsset.get(h.asset_id) ?? "transparent" }} />
            <span className="font-mono text-xs">{h.asset_old_code}</span>
          </span>
        );
      case "__opened": return <span className="text-xs whitespace-nowrap">{fmtDate(h.opened_at)}</span>;
      case "__closed": return <span className="text-xs whitespace-nowrap text-muted-foreground">{fmtDate(h.closed_at)}</span>;
      case "__responseTime": {
        const v = Number((p as { responseTime?: unknown; ResponseTime?: unknown }).responseTime ?? (p as { ResponseTime?: unknown }).ResponseTime);
        return <span className="text-xs whitespace-nowrap tabular-nums">{Number.isFinite(v) && v > 0 ? formatMinutes(v) : "—"}</span>;
      }
      case "__resolveTime": {
        const v = Number((p as { resolveTime?: unknown; ResolveTime?: unknown }).resolveTime ?? (p as { ResolveTime?: unknown }).ResolveTime);
        return <span className="text-xs whitespace-nowrap tabular-nums">{Number.isFinite(v) && v > 0 ? formatMinutes(v) : "—"}</span>;
      }
      case "__totalTurnaround": {
        const v = Number((p as { totalTurnaroundTime?: unknown; TotalTurnaroundTime?: unknown }).totalTurnaroundTime ?? (p as { TotalTurnaroundTime?: unknown }).TotalTurnaroundTime);
        return <span className="text-xs whitespace-nowrap tabular-nums">{Number.isFinite(v) && v > 0 ? formatMinutes(v) : "—"}</span>;
      }
      case "__duration": return <span className="text-xs whitespace-nowrap tabular-nums">{durationLabel(h.status, h.opened_at, h.closed_at, h.payload as Record<string, unknown> | null)}</span>;
      case "__title": return <span className="whitespace-nowrap">{h.title ?? "—"}</span>;
      case "__status": return <Badge tone={/finish|approved|closed|done/i.test(h.status ?? "") ? "success" : "warning"}>{h.status ?? "—"}</Badge>;
      default: {
        const v = p[key];
        if (v == null || v === "") return <span className="text-muted-foreground">—</span>;
        const str = typeof v === "object" ? JSON.stringify(v) : String(v);
        return <span className="text-xs break-words max-w-[260px] inline-block align-top">{str}</span>;
      }
    }
  };

  const hiddenCount = hidden.size;

  return (
    <div className="rounded-xl border overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-b bg-muted/30">
        <div className="text-sm font-medium">ข้อมูลดิบ ({total} รายการ)</div>
        <div className="flex items-center gap-2 text-sm">
          <div className="relative">
            <button
              onClick={() => setShowColPanel((v) => !v)}
              className="h-8 px-3 rounded border bg-background hover:bg-accent text-xs inline-flex items-center gap-1"
              title="ซ่อน/แสดงคอลัมน์"
            >
              <Eye className="size-3.5" /> จัดการคอลัมน์
              {hiddenCount > 0 && <span className="ml-1 rounded-full bg-primary text-primary-foreground px-1.5 py-0.5 text-[10px]">ซ่อน {hiddenCount}</span>}
              <ChevronDown className="size-3" />
            </button>
            {showColPanel && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowColPanel(false)} />
                <div className="absolute right-0 z-40 mt-1 w-72 rounded-lg border bg-popover shadow-lg p-3 max-h-[60vh] overflow-auto">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold">คอลัมน์ที่แสดง</div>
                    <button onClick={resetHidden} className="text-[11px] text-primary hover:underline">รีเซ็ต</button>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase text-muted-foreground mt-1 mb-1">คอลัมน์หลัก</div>
                    {coreCols.map((c) => (
                      <label key={c.key} className="flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-accent cursor-pointer">
                        <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleHide(c.key)} />
                        <span>{c.label}</span>
                      </label>
                    ))}
                    {payloadKeys.length > 0 && (
                      <>
                        <div className="text-[10px] uppercase text-muted-foreground mt-3 mb-1">ฟิลด์จากข้อมูล ({payloadKeys.length})</div>
                        {payloadKeys.map((k) => (
                          <label key={k} className="flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-accent cursor-pointer">
                            <input type="checkbox" checked={!hidden.has(`p:${k}`)} onChange={() => toggleHide(`p:${k}`)} />
                            <span className="font-mono">{k}</span>
                          </label>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <span className="text-muted-foreground">แสดง</span>
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="h-8 rounded border bg-background px-2 text-sm">
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm border-separate border-spacing-0" style={{ minWidth: Math.max(900, totalCols * 140) }}>
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              {visibleCore.map((c) => (
                <th key={c.key} className={cn("text-left px-4 py-2.5 whitespace-nowrap border-b", c.sticky && "sticky left-0 bg-muted/60 z-10")}>
                  {c.label}
                </th>
              ))}
              {visiblePayload.map((k) => (
                <th key={k} className="text-left px-4 py-2.5 whitespace-nowrap font-mono border-b">{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={Math.max(totalCols, 1)} className="px-4 py-8 text-center text-muted-foreground text-sm border-b">ไม่มีข้อมูลในช่วงที่เลือก</td></tr>
            ) : pageRows.map((h) => (
              <tr key={h.id} className="hover:bg-accent/30 align-top">
                {visibleCore.map((c) => (
                  <td key={c.key} className={cn("px-4 py-2.5 border-b", c.sticky && "sticky left-0 bg-card z-[1]")}>
                    {renderCell(h, c.key)}
                  </td>
                ))}
                {visiblePayload.map((k) => (
                  <td key={k} className="px-4 py-2.5 border-b">{renderCell(h, k)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between p-3 border-t bg-muted/20 text-sm">
          <span className="text-muted-foreground text-xs">หน้า {page} / {totalPages}</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded border bg-background disabled:opacity-50 hover:bg-accent text-xs">‹ ก่อนหน้า</button>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded border bg-background disabled:opacity-50 hover:bg-accent text-xs">ถัดไป ›</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Regular Tab (PM/Claim/Monitor) ============
type Asset = { id: string; old_code: string; name: string | null; department: string | null; area: string | null; status: string | null; latitude?: number | null; longitude?: number | null; installed_at?: string | null; last_pm_at?: string | null; last_claim_at?: string | null; last_monitor_ok_at?: string | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HistRow = any;

function RegularTab({
  tab, assets, history, colorByAsset, page, setPage, pageSize, setPageSize,
}: {
  tab: TabId; assets: Asset[]; history: HistRow[]; colorByAsset: Map<string, string>;
  page: number; setPage: (n: number) => void; pageSize: number; setPageSize: (n: number) => void;
}) {
  // Summary
  const total = history.length;
  const finished = history.filter((h) => h.status && /finish|approved|closed|done/i.test(h.status)).length;
  const pending = total - finished;

  // Avg per month per asset (over date range present in data)
  const months = new Set<string>();
  history.forEach((h) => { if (h.opened_at) months.add(h.opened_at.slice(0, 7)); });
  const monthsCount = Math.max(months.size, 1);
  const avgPerMonth = total / monthsCount / Math.max(assets.length, 1);

  // Avg interval (days) per asset
  const intervals: number[] = [];
  for (const a of assets) {
    const dates = history
      .filter((h) => h.asset_id === a.id && h.opened_at)
      .map((h) => new Date(h.opened_at).getTime())
      .sort((x, y) => x - y);
    for (let i = 1; i < dates.length; i++) intervals.push((dates[i] - dates[i - 1]) / 86_400_000);
  }
  const avgInterval = intervals.length ? intervals.reduce((s, n) => s + n, 0) / intervals.length : 0;

  // Claim-specific: response/resolve time
  let avgResponse = 0, avgResolve = 0;
  if (tab === "Claim") {
    const rt: number[] = [], rs: number[] = [];
    history.forEach((h) => {
      const r = Number(h.payload?.responseTime); if (Number.isFinite(r)) rt.push(r);
      const s = Number(h.payload?.resolveTime); if (Number.isFinite(s)) rs.push(s);
    });
    avgResponse = rt.length ? rt.reduce((a, b) => a + b, 0) / rt.length : 0;
    avgResolve = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
  }

  // Trend chart per asset per month — แสดงครบ 12 เดือนของปีที่เลือก
  const yearsAvailable = Array.from(new Set(
    history.map((h) => eventDate(h)?.slice(0, 4)).filter(Boolean) as string[]
  )).sort();
  const defaultYear = yearsAvailable[yearsAvailable.length - 1] ?? String(new Date().getFullYear());
  const [chartYear, setChartYear] = useState(defaultYear);
  useEffect(() => { setChartYear(defaultYear); }, [defaultYear]);
  const thMonthsShort = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  const chartData = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, "0");
    const key = `${chartYear}-${mm}`;
    const row: Record<string, string | number> = { month: `${thMonthsShort[i]} ${String(Number(chartYear) + 543).slice(-2)}` };
    for (const a of assets) {
      row[a.old_code] = history.filter((h) => h.asset_id === a.id && eventDate(h)?.startsWith(key)).length;
    }
    return row;
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageStart = (page - 1) * pageSize;
  const pageRows = history.slice(pageStart, pageStart + pageSize);

  const alerts = history.filter((h) => h.status && /pend|work/i.test(h.status)).slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className={cn("grid gap-4", tab === "Claim" ? "sm:grid-cols-2 lg:grid-cols-5" : "sm:grid-cols-2 lg:grid-cols-4")}>
        <StatCard label="รายการทั้งหมด" value={total} tone="default" />
        <StatCard label="เสร็จสิ้น" value={finished} tone="success" />
        <StatCard label="ค้าง / กำลังดำเนินการ" value={pending} tone="warning" delta={`เฉลี่ย ${avgPerMonth.toFixed(1)}/เดือน/ป้าย`} />
        <StatCard label="ความถี่เฉลี่ย" value={`${avgInterval.toFixed(1)} วัน`} delta="ระยะห่างเฉลี่ยระหว่างงาน" />
        {tab === "Claim" && (
          <StatCard label="Response / Resolve" value={`${formatMinutes(avgResponse)} / ${formatMinutes(avgResolve)}`} tone="default" />
        )}
      </div>

      {/* Trend chart — ครบ 12 เดือน + เลือกปี */}
      {history.length > 0 && (
        <div className="rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-sm font-medium">แนวโน้มรายเดือน — {tab} <span className="text-xs text-muted-foreground">(ครบ 12 เดือน)</span></div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">ปี</span>
              <select value={chartYear} onChange={(e) => setChartYear(e.target.value)} className="h-8 rounded border bg-background px-2 text-xs">
                {(yearsAvailable.length ? yearsAvailable : [defaultYear]).map((y) => (
                  <option key={y} value={y}>{Number(y) + 543}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0 0)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <RTooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {assets.map((a) => (
                  <Line key={a.id} type="monotone" dataKey={a.old_code} stroke={colorByAsset.get(a.id)} strokeWidth={2} dot connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Alerts (PM only) */}
      {tab === "PM" && alerts.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
          <div className="text-sm font-medium mb-2 flex items-center gap-2"><AlertCircle className="size-4" /> งาน PM ที่รอบใกล้ครบ / ค้าง</div>
          <ul className="text-sm space-y-1">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <Badge tone="warning">{a.status}</Badge>
                <span className="font-mono text-xs">{a.asset_old_code}</span>
                <span className="text-muted-foreground text-xs">{fmtDate(a.opened_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Raw table */}
      <RawDataTable
        tab={tab}
        history={history}
        total={total}
        pageRows={pageRows}
        page={page}
        setPage={setPage}
        pageSize={pageSize}
        setPageSize={setPageSize}
        totalPages={totalPages}
        colorByAsset={colorByAsset}
      />
    </div>
  );
}

// ============ Asset Health Tab ============
function AssetHealthTab({
  assets, history, colorByAsset, sel, onSel,
  pmFreqDays, setPmFreqDays, debtMonths, setDebtMonths,
  pmSchedRows,
}: {
  assets: Asset[]; history: HistRow[]; colorByAsset: Map<string, string>;
  sel: { PM: boolean; Claim: boolean; Monitor: boolean; PMSchedule: boolean }; onSel: (s: typeof sel) => void;
  pmFreqDays: number; setPmFreqDays: (n: number) => void;
  debtMonths: number; setDebtMonths: (n: number) => void;
  pmSchedRows: PmScheduleRow[];
}) {
  const [view, setView] = useState<"graph" | "table" | "calendar">("graph");
  const [gran, setGran] = useState<"month" | "year">("month");
  const keyLen = gran === "month" ? 7 : 4;
  const [openCell, setOpenCell] = useState<{ assetId: string; type: "PM" | "Claim" | "Monitor"; mo: number } | null>(null);

  // Per-asset metrics — Claim ใช้ opened_at, PM/Monitor ใช้ closed_at (อัพเดทล่าสุด)
  const perAsset = assets.map((a) => {
    const ph = history.filter((h) => h.asset_id === a.id);
    const toTs = (xs: HistRow[]) => xs.map((h) => {
      const d = eventDate(h);
      return d ? new Date(d).getTime() : 0;
    }).filter(Boolean).sort((x, y) => x - y);
    const claims = toTs(ph.filter((h) => h.type === "Claim"));
    const pms = toTs(ph.filter((h) => h.type === "PM"));
    const mons = toTs(ph.filter((h) => h.type === "Monitor"));
    const avg = (xs: number[]) => {
      const diffs: number[] = []; for (let i = 1; i < xs.length; i++) diffs.push((xs[i] - xs[i - 1]) / 86_400_000);
      return diffs.length ? diffs.reduce((s, n) => s + n, 0) / diffs.length : 0;
    };
    return {
      asset: a,
      mtbf: avg(claims),
      pmInterval: avg(pms),
      monInterval: avg(mons),
      counts: { PM: pms.length, Claim: claims.length, Monitor: mons.length },
    };
  });

  // Combined trend (per bucket, aggregated across all selected assets) — granularity = month or year
  const thMonthsShort = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const fmtBucket = (m: string) => {
    if (gran === "year") return `พ.ศ. ${Number(m) + 543}`;
    const [y, mo] = m.split("-");
    return `${thMonthsShort[Number(mo) - 1]} ${String(Number(y) + 543).slice(-2)}`;
  };
  // รวมเดือนจาก history + schedule_date ของ PM แผน
  const buckets = new Set<string>();
  history.forEach((h) => { const d = eventDate(h); if (d) buckets.add(d.slice(0, keyLen)); });
  pmSchedRows.forEach((r) => { if (r.schedule_date) buckets.add(r.schedule_date.slice(0, keyLen)); });
  const bucketLabels = Array.from(buckets).sort();
  const chartData = bucketLabels.map((m) => {
    const inBucket = history.filter((h) => eventDate(h)?.startsWith(m));
    const schedInBucket = pmSchedRows.filter((r) => r.schedule_date?.startsWith(m)).length;
    return {
      bucket: fmtBucket(m),
      PM: sel.PM ? inBucket.filter((h) => h.type === "PM").length : 0,
      Claim: sel.Claim ? inBucket.filter((h) => h.type === "Claim").length : 0,
      Monitor: sel.Monitor ? inBucket.filter((h) => h.type === "Monitor").length : 0,
      PMSchedule: sel.PMSchedule ? schedInBucket : 0,
    };
  });

  // Avg MTBF across selected assets
  const mtbfVals = perAsset.map((p) => p.mtbf).filter((n) => n > 0);
  const avgMtbf = mtbfVals.length ? mtbfVals.reduce((s, n) => s + n, 0) / mtbfVals.length : 0;
  const avgPm = perAsset.map((p) => p.pmInterval).filter((n) => n > 0);
  const avgPmInterval = avgPm.length ? avgPm.reduce((s, n) => s + n, 0) / avgPm.length : 0;

  // นับจำนวนเหตุการณ์รวมทุกป้าย เพื่อตัดสินว่า simulator ใช้งานได้หรือไม่
  const totalPm = perAsset.reduce((s, p) => s + p.counts.PM, 0);
  const totalClaim = perAsset.reduce((s, p) => s + p.counts.Claim, 0);
  const hasPmData = totalPm >= 2 && avgPmInterval > 0;
  const hasClaimData = totalClaim >= 2 && avgMtbf > 0;

  // Simulator 1: ปรับความถี่ PM → คาด Claim ลด/เพิ่ม (ต้องมี PM ≥ 2 ครั้ง จึงคำนวณ baseline ได้)
  const baselinePm = hasPmData ? avgPmInterval : 0;
  const reduction = hasPmData ? Math.max(-80, Math.min(80, ((baselinePm - pmFreqDays) / baselinePm) * 60)) : 0;

  // Simulator 2: หนี้บำรุงรักษา (ต้องมี Claim ≥ 2 จึงรู้ MTBF จริง)
  const effMtbf = avgMtbf;
  const expectedExtraFailures = hasClaimData ? Math.round((debtMonths * 30 / effMtbf) * Math.max(assets.length, 1)) : 0;

  // Service-level (ต้องมี Claim พร้อม responseTime ใน payload)
  const avgResponse = (() => {
    const rt = history.filter((h) => h.type === "Claim").map((h) => Number(h.payload?.responseTime)).filter((n) => Number.isFinite(n) && n > 0);
    return rt.length ? rt.reduce((a, b) => a + b, 0) / rt.length : 0;
  })();
  const hasResponseData = avgResponse > 0 && hasClaimData;
  const curResponse = hasResponseData ? avgResponse : 0;
  const availability = hasResponseData ? Math.max(0, Math.min(100, 100 - (curResponse / (effMtbf * 24)) * 100)) : 0;

  // Simulator 3 — slider state ต้องสร้างเสมอ (ห้ามมี hook แบบ conditional)
  const [targetResponse, setTargetResponse] = useState<number>(24);
  const projAvailability = hasResponseData ? Math.max(0, Math.min(100, 100 - (targetResponse / (effMtbf * 24)) * 100)) : 0;
  const availDelta = projAvailability - availability;



  return (
    <div className="space-y-6">
      {/* Select types + view */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(["PM", "Claim", "Monitor", "PMSchedule"] as const).map((t) => (
            <label
              key={t}
              className={cn(
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer text-sm",
                sel[t] ? "text-white" : "bg-background",
              )}
              style={sel[t] ? { background: TYPE_COLOR[t], borderColor: TYPE_COLOR[t] } : undefined}
              title={t === "PMSchedule" ? "แผน PM ที่วางไว้ (จาก Asset_PM_Schedule)" : undefined}
            >
              <input type="checkbox" checked={sel[t]} onChange={(e) => onSel({ ...sel, [t]: e.target.checked })} className="size-3.5" />
              {t === "PMSchedule" ? "PM แผน" : t}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border overflow-hidden">
            {(["month", "year"] as const).map((g) => (
              <button key={g} onClick={() => setGran(g)} className={cn("px-3 py-1.5 text-sm", gran === g ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}>
                {g === "month" ? "รายเดือน" : "รายปี"}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border overflow-hidden">
            {(["graph", "table", "calendar"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={cn("px-3 py-1.5 text-sm capitalize", view === v ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}>
                {v === "graph" ? "Graph" : v === "table" ? "Table" : "Calendar"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* PM Schedule summary (สถานะการ PM ตามแผนจาก Modern Corporate Server) */}
      {(() => {
        const sched = pmSchedRows.filter((r) => assets.some((a) => a.old_code === r.asset_old_code));
        if (!sched.length) {
          return (
            <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
              ยังไม่มี PM Schedule สำหรับป้ายที่เลือก (ไม่มีในตาราง Asset_PM_Schedule)
            </div>
          );
        }
        const items = sched.map((r) => ({ row: r, s: computePmSchedStatus(r) }));
        const isDone = (k: PmSchedStatus["kind"]) => k === "approved" || k === "finished";
        const done = items.filter((x) => isDone(x.s.kind)).length;
        const overdue = items.filter((x) => x.s.kind === "overdue");
        const upcoming = items.filter((x) => x.s.kind === "upcoming").length;
        const maxOverdue = overdue.reduce((m, x) => (x.s.kind === "overdue" && x.s.days > m ? x.s.days : m), 0);
        const lastDoneByAsset = new Map<string, string>();
        items.forEach(({ row, s }) => {
          if (!isDone(s.kind) || !row.asset_old_code) return;
          const d = (s.kind === "approved" || s.kind === "finished") ? s.doneDate : null;
          if (!d) return;
          const prev = lastDoneByAsset.get(row.asset_old_code);
          if (!prev || new Date(d).getTime() > new Date(prev).getTime()) {
            lastDoneByAsset.set(row.asset_old_code, d);
          }
        });
        return (
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock className="size-4 text-primary" />
              <h4 className="font-semibold text-sm">PM Schedule (จากตารางที่วางแผนไว้)</h4>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-md bg-muted/40 p-2.5">
                <div className="text-[11px] text-muted-foreground">ทั้งหมด</div>
                <div className="text-xl font-semibold">{sched.length}</div>
              </div>
              <div className="rounded-md bg-success/10 p-2.5">
                <div className="text-[11px] text-success">ทำแล้ว</div>
                <div className="text-xl font-semibold text-success">{done}</div>
              </div>
              <div className="rounded-md bg-destructive/10 p-2.5">
                <div className="text-[11px] text-destructive">เกินกำหนด</div>
                <div className="text-xl font-semibold text-destructive">{overdue.length}</div>
                {maxOverdue > 0 && <div className="text-[10px] text-destructive/80">สูงสุด {maxOverdue} วัน</div>}
              </div>
              <div className="rounded-md bg-muted/40 p-2.5">
                <div className="text-[11px] text-muted-foreground">รอถึงกำหนด</div>
                <div className="text-xl font-semibold">{upcoming}</div>
              </div>
            </div>
            {lastDoneByAsset.size > 0 && (
              <div className="mt-3 text-[11px] text-muted-foreground">
                PM ล่าสุดที่ทำแล้ว: {Array.from(lastDoneByAsset.entries()).map(([c, d]) => `${c} (${fmtDate(d)})`).join(" · ")}
              </div>
            )}
            {overdue.length > 0 && (
              <div className="mt-2 text-[11px] text-destructive">
                ป้ายที่ค้าง: {overdue.slice(0, 5).map((x) => x.s.kind === "overdue" ? `${x.row.asset_old_code} (${x.s.days}d)` : "").filter(Boolean).join(", ")}{overdue.length > 5 ? ` …+${overdue.length - 5}` : ""}
              </div>
            )}
          </div>
        );
      })()}


      {/* Per-asset metrics + 12-month matrix */}
      <div className="space-y-4">
        {perAsset.map((p) => {
          const ph = history.filter((h) => h.asset_id === p.asset.id);
          const psched = pmSchedRows.filter((r) => r.asset_old_code === p.asset.old_code);
          // pick most recent year with data (history OR PM แผน), fallback current year
          const yearsAll = new Set<string>();
          ph.forEach((h) => { const y = eventDate(h)?.slice(0, 4); if (y) yearsAll.add(y); });
          psched.forEach((r) => { const y = r.schedule_date?.slice(0, 4); if (y) yearsAll.add(y); });
          const years = Array.from(yearsAll);
          const matrixYear = years.sort().pop() ?? String(new Date().getFullYear());
          const matrix: Record<"PM" | "Claim" | "Monitor" | "PMSchedule", number[]> = {
            PM: Array(12).fill(0), Claim: Array(12).fill(0), Monitor: Array(12).fill(0), PMSchedule: Array(12).fill(0),
          };
          ph.forEach((h) => {
            const d = eventDate(h);
            if (!d?.startsWith(matrixYear)) return;
            const mo = Number(d.slice(5, 7)) - 1;
            if (mo >= 0 && mo < 12 && (h.type === "PM" || h.type === "Claim" || h.type === "Monitor")) {
              matrix[h.type as "PM" | "Claim" | "Monitor"][mo]++;
            }
          });
          psched.forEach((r) => {
            const d = r.schedule_date;
            if (!d?.startsWith(matrixYear)) return;
            const mo = Number(d.slice(5, 7)) - 1;
            if (mo >= 0 && mo < 12) matrix.PMSchedule[mo]++;
          });
          const maxVal = Math.max(1, ...matrix.PM, ...matrix.Claim, ...matrix.Monitor, ...matrix.PMSchedule);

          return (
            <div key={p.asset.id} className="rounded-xl border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className="size-3 rounded-full shrink-0" style={{ background: colorByAsset.get(p.asset.id) }} />
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted">{p.asset.old_code}</span>
                  <span className="text-sm font-medium truncate flex-1 min-w-0">{p.asset.name ?? "—"}</span>
                  {p.asset.status && (
                    <span className={cn(
                      "text-[10px] px-2 py-0.5 rounded-full font-medium",
                      /active|online|ok|ใช้งาน/i.test(p.asset.status) ? "bg-emerald-100 text-emerald-700" :
                      /offline|down|เสีย|ปิด/i.test(p.asset.status) ? "bg-red-100 text-red-700" :
                      "bg-amber-100 text-amber-700"
                    )}>{p.asset.status}</span>
                  )}
                  <span className="text-xs text-muted-foreground shrink-0">ปี {Number(matrixYear) + 543}</span>
                </div>
                <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-muted-foreground">
                  {p.asset.area && (
                    <span className="inline-flex items-center gap-1" title="พื้นที่ติดตั้ง">
                      <MapPin className="size-3" /> {p.asset.area}
                    </span>
                  )}
                  {p.asset.department && (
                    <span className="inline-flex items-center gap-1" title="แผนกผู้ดูแล">
                      <Building2 className="size-3" /> {p.asset.department}
                    </span>
                  )}
                  {p.asset.latitude != null && p.asset.longitude != null && (
                    <a
                      href={`https://www.google.com/maps?q=${p.asset.latitude},${p.asset.longitude}`}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-primary underline-offset-2 hover:underline"
                      title="เปิดใน Google Maps"
                    >
                      📍 {Number(p.asset.latitude).toFixed(4)}, {Number(p.asset.longitude).toFixed(4)}
                    </a>
                  )}
                  {p.asset.installed_at && (
                    <span title="วันที่ติดตั้ง">🗓 ติดตั้ง {new Date(p.asset.installed_at).toLocaleDateString("th-TH", { year: "2-digit", month: "short", day: "numeric" })}</span>
                  )}
                  {p.asset.last_pm_at && (
                    <span title="PM ครั้งล่าสุด">
                      <Wrench className="inline size-3 mr-0.5" />
                      PM ล่าสุด {new Date(p.asset.last_pm_at).toLocaleDateString("th-TH", { year: "2-digit", month: "short", day: "numeric" })}
                    </span>
                  )}
                  {p.asset.last_claim_at && (
                    <span title="Claim ครั้งล่าสุด">
                      <AlertCircle className="inline size-3 mr-0.5" />
                      Claim ล่าสุด {new Date(p.asset.last_claim_at).toLocaleDateString("th-TH", { year: "2-digit", month: "short", day: "numeric" })}
                    </span>
                  )}
                </div>
              </div>


              <div className="grid lg:grid-cols-[260px_1fr] gap-0">
                {/* KPI ซ้าย */}
                <div className="p-4 lg:border-r">
                  {(() => {
                    const items = [
                      { key: "MTBF", value: p.mtbf, n: p.counts.Claim, unit: "วัน",
                        sub: "ระหว่าง Claim",
                        tip: `เฉลี่ยจาก ${Math.max(0, p.counts.Claim - 1)} ช่วงห่าง ระหว่าง Claim ${p.counts.Claim} ครั้ง` },
                      { key: "PM ทุก", value: p.pmInterval, n: p.counts.PM, unit: "วัน",
                        sub: "ระหว่าง PM",
                        tip: `เฉลี่ยจาก ${Math.max(0, p.counts.PM - 1)} ช่วงห่าง ระหว่าง PM ${p.counts.PM} ครั้ง` },
                      { key: "ตรวจทุก", value: p.monInterval, n: p.counts.Monitor, unit: "วัน",
                        sub: "ระหว่าง Monitor",
                        tip: `เฉลี่ยจาก ${Math.max(0, p.counts.Monitor - 1)} ช่วงห่าง ระหว่าง Monitor ${p.counts.Monitor} ครั้ง` },
                    ];
                    return (
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        {items.map((it) => {
                          const weak = it.n < 3;
                          const none = it.n < 2;
                          return (
                            <div key={it.key} title={it.tip}>
                              <div className="text-xl font-bold tabular-nums">
                                {none ? "—" : it.value.toFixed(0)}
                              </div>
                              <div className="text-muted-foreground leading-tight">
                                {it.key}<br/>({it.unit})
                              </div>
                              <div className={cn("mt-0.5 text-[10px] leading-tight", weak ? "text-amber-600" : "text-muted-foreground/70")}>
                                n={it.n}{weak && !none ? " ⚠︎" : ""}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  <div className="mt-3 flex gap-3 text-xs text-muted-foreground border-t pt-2 justify-between">
                    <span>PM {p.counts.PM}</span><span>Claim {p.counts.Claim}</span><span>Monitor {p.counts.Monitor}</span>
                  </div>
                  <details className="mt-2 text-[11px] text-muted-foreground">
                    <summary className="cursor-pointer hover:text-foreground">ตัวเลขนี้คำนวณยังไง?</summary>
                    <ul className="mt-1.5 space-y-1 pl-3 list-disc">
                      <li><b>วิธีคำนวณ</b>: เรียงเหตุการณ์ตามเวลา → หาช่วงห่างระหว่างคู่ติดกัน (วัน) → เฉลี่ย</li>
                      <li><b>MTBF</b> = ช่วงห่างเฉลี่ยระหว่าง Claim (ค่าสูง = ป้ายเสถียร)</li>
                      <li><b>PM ทุก</b> = ช่วงห่างเฉลี่ยระหว่าง PM ที่ <i>เกิดขึ้นจริง</i> (ไม่ใช่แผน)</li>
                      <li><b>ตรวจทุก</b> = ช่วงห่างเฉลี่ยระหว่าง Monitoring</li>
                      <li><b>n</b> = จำนวนเหตุการณ์ที่ใช้คำนวณ — <b className="text-amber-600">n&lt;3 = ตัวอย่างน้อย ค่าอาจคลาดเคลื่อน</b> (เช่น PM 2 ครั้งห่างกัน 15 วัน ≠ ทำ PM ทุก 15 วันจริง)</li>
                      <li>แสดง "—" เมื่อ n&lt;2 (น้อยกว่า 2 ครั้ง ไม่มีช่วงห่างให้คำนวณ)</li>
                    </ul>
                  </details>
                </div>

                {/* Matrix 12 เดือน × 3 ประเภท */}
                <div className="p-4 overflow-x-auto">
                  <div className="text-[11px] text-muted-foreground mb-1.5">จำนวนงานรายเดือน ปี {Number(matrixYear) + 543} (สีเข้ม = เยอะ)</div>
                  <table className="w-full text-[11px] border-separate border-spacing-0.5">
                    <thead>
                      <tr>
                        <th className="text-left font-normal text-muted-foreground w-14"></th>
                        {thMonthsShort.map((m) => (
                          <th key={m} className="font-normal text-muted-foreground text-center">{m.replace(".", "")}</th>
                        ))}
                        <th className="font-medium text-center w-10">รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(["PM", "Claim", "Monitor", "PMSchedule"] as const).filter((t) => sel[t]).map((t) => {
                        const sum = matrix[t].reduce((a, b) => a + b, 0);
                        const label = t === "PMSchedule" ? "PM แผน" : t;
                        return (
                          <tr key={t}>
                            <td className="text-muted-foreground pr-1">
                              <span className="inline-flex items-center gap-1" title={t === "PMSchedule" ? "แผน PM ที่วางไว้ (schedule_date)" : undefined}>
                                <span className="size-2 rounded-sm" style={{ background: TYPE_COLOR[t] }} />
                                {label}
                              </span>
                            </td>
                            {matrix[t].map((v, i) => {
                              const alpha = v === 0 ? 0 : 0.15 + (v / maxVal) * 0.75;
                              const clickable = v > 0 && t !== "PMSchedule";
                              const isOpen = clickable && openCell?.assetId === p.asset.id && openCell.type === t && openCell.mo === i;
                              return (
                                <td
                                  key={i}
                                  className={cn("text-center tabular-nums rounded h-7 align-middle p-0", isOpen && "ring-2 ring-primary")}
                                  style={{
                                    background: v === 0 ? "transparent" : `color-mix(in oklab, ${TYPE_COLOR[t]} ${Math.round(alpha * 100)}%, transparent)`,
                                    color: alpha > 0.55 ? "white" : undefined,
                                  }}
                                  title={`${label} • ${thMonthsShort[i]} ${Number(matrixYear) + 543}: ${v} ${t === "PMSchedule" ? "แผน" : "ครั้ง"}${clickable ? " (คลิกเพื่อดูรายการ)" : ""}`}
                                >
                                  {v > 0 ? (
                                    clickable ? (
                                      <button
                                        type="button"
                                        onClick={() => setOpenCell(isOpen ? null : { assetId: p.asset.id, type: t as "PM" | "Claim" | "Monitor", mo: i })}
                                        className="w-full h-7 cursor-pointer hover:brightness-110"
                                      >
                                        {v}
                                      </button>
                                    ) : (
                                      <span className="w-full inline-block h-7 leading-7">{v}</span>
                                    )
                                  ) : ""}
                                </td>
                              );
                            })}
                            <td className="text-center font-semibold tabular-nums bg-muted/40 rounded">{sum}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* รายการของช่องที่คลิก */}
                  {openCell?.assetId === p.asset.id && (() => {
                    const mm = String(openCell.mo + 1).padStart(2, "0");
                    const prefix = `${matrixYear}-${mm}`;
                    const items = ph
                      .filter((h) => h.type === openCell.type && eventDate(h)?.startsWith(prefix))
                      .sort((a, b) => ((eventDate(a) ?? "") < (eventDate(b) ?? "") ? -1 : 1));
                    return (
                      <div className="mt-3 rounded-lg border bg-muted/20 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-medium">
                            <span className="inline-block size-2 rounded-sm mr-1.5 align-middle" style={{ background: TYPE_COLOR[openCell.type] }} />
                            {openCell.type} • {thMonthsShort[openCell.mo]} {Number(matrixYear) + 543} — {items.length} รายการ
                          </div>
                          <button onClick={() => setOpenCell(null)} className="text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
                        </div>
                        <ul className="space-y-1 text-[11px]">
                          {items.map((h) => {
                            const pl = (h.payload ?? {}) as Record<string, unknown>;
                            return (
                              <li key={h.id} className="flex items-start gap-2 bg-background rounded px-2 py-1.5">
                                <span className="text-muted-foreground tabular-nums w-20 shrink-0">{fmtDate(h.opened_at)}</span>
                                <span className="flex-1 min-w-0">
                                  <span className="font-medium">{h.title ?? "—"}</span>
                                  {(pl.problemDetail || pl.solutionDetail) ? (
                                    <span className="text-muted-foreground"> · {String(pl.problemDetail ?? pl.solutionDetail ?? "")}</span>
                                  ) : null}
                                </span>
                                <Badge tone={/finish|approved|closed|done/i.test(h.status ?? "") ? "success" : "warning"}>{h.status ?? "—"}</Badge>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* View */}
      {view === "graph" && (
        <div className="rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <div className="text-sm font-medium">จำนวนงานต่อ{gran === "month" ? "เดือน" : "ปี"} (รวมทุกป้ายที่เลือก)</div>
              <div className="text-xs text-muted-foreground mt-0.5">แต่ละแท่งคือจำนวนครั้งที่เกิดในช่วงเวลานั้น แยกสีตามประเภท</div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {(["PM", "Claim", "Monitor", "PMSchedule"] as const).filter((t) => sel[t]).map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ background: TYPE_COLOR[t] }} />
                  {t === "PMSchedule" ? "PM แผน" : t}
                </span>
              ))}
            </div>
          </div>
          <div className="h-72">
            {chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                ไม่มีข้อมูลในช่วงที่เลือก
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0 0)" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <RTooltip cursor={{ fill: "oklch(0.95 0 0 / 0.5)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {sel.PM && <Bar dataKey="PM" fill={TYPE_COLOR.PM} radius={[4, 4, 0, 0]} maxBarSize={48} />}
                  {sel.Claim && <Bar dataKey="Claim" fill={TYPE_COLOR.Claim} radius={[4, 4, 0, 0]} maxBarSize={48} />}
                  {sel.Monitor && <Bar dataKey="Monitor" fill={TYPE_COLOR.Monitor} radius={[4, 4, 0, 0]} maxBarSize={48} />}
                  {sel.PMSchedule && <Bar dataKey="PMSchedule" name="PM แผน" fill={TYPE_COLOR.PMSchedule} radius={[4, 4, 0, 0]} maxBarSize={48} />}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            💡 อ่านยังไง: ดูแท่งสูง = ช่วงนั้นเกิดงานเยอะ · ถ้าแท่งแดง (Claim) เยอะ = มีปัญหาเยอะ · ถ้าแท่งฟ้า (PM) เยอะ = ทำการบำรุงรักษาบ่อย
          </p>
        </div>
      )}

      {(view === "table" || view === "calendar") && (() => {
        // สังเคราะห์ "PM แผน" ให้เป็นแถวเดียวกับ history เพื่อแสดงร่วมในมุมมอง Table/Calendar
        const assetById = new Map(assets.map((a) => [a.old_code, a.id]));
        const pmSchedHist: HistRow[] = pmSchedRows
          .filter((r) => r.schedule_date)
          .map((r) => {
            const s = computePmSchedStatus(r);
            const statusLabel =
              s.kind === "approved" ? `อนุมัติแล้ว (${fmtDate(s.doneDate)})`
              : s.kind === "finished" ? `ทำเสร็จ รอตรวจ (${fmtDate(s.doneDate)})`
              : s.kind === "working" ? `กำลังทำงาน${s.updatedAt ? ` · ${fmtDate(s.updatedAt)}` : ""}`
              : s.kind === "overdue" ? `เกินกำหนด ${s.days} วัน`
              : s.kind === "upcoming" ? `อีก ${s.days} วัน`
              : s.kind === "pending" ? "รอจ่ายงาน"
              : "—";
            return {
              id: `ps-${r.id}`,
              type: "PMSchedule",
              asset_id: r.asset_old_code ? assetById.get(r.asset_old_code) ?? null : null,
              asset_old_code: r.asset_old_code,
              opened_at: r.schedule_date,
              closed_at: null,
              status: statusLabel,
              pmStatusKind: s.kind,
            } as HistRow;
          });
        const merged: HistRow[] = sel.PMSchedule ? [...history, ...pmSchedHist] : history;
        const filtered = merged.filter((h) => sel[h.type as keyof typeof sel]);
        return (
          <>
            {view === "table" && (
              <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr><th className="text-left px-4 py-2.5">ป้าย</th><th className="text-left px-4 py-2.5">ประเภท</th><th className="text-left px-4 py-2.5">วันที่</th><th className="text-left px-4 py-2.5">สถานะ</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered
                      .slice()
                      .sort((a, b) => ((eventDate(b) ?? "") < (eventDate(a) ?? "") ? -1 : 1))
                      .slice(0, 80)
                      .map((h) => {
                        const tone =
                          h.type === "Claim" ? "danger"
                          : h.type === "PM" ? "info"
                          : h.type === "PMSchedule"
                            ? (h.pmStatusKind === "overdue" ? "danger"
                              : h.pmStatusKind === "approved" || h.pmStatusKind === "finished" ? "success"
                              : "warning")
                          : "success";
                        const label = h.type === "PMSchedule" ? "PM แผน" : h.type;
                        return (
                          <tr key={h.id}>
                            <td className="px-4 py-2 font-mono text-xs">{h.asset_old_code}</td>
                            <td className="px-4 py-2 text-xs"><Badge tone={tone}>{label}</Badge></td>
                            <td className="px-4 py-2 text-xs">{fmtDate(h.opened_at)}</td>
                            <td className="px-4 py-2 text-xs">{h.status ?? "—"}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                {filtered.length > 80 && (
                  <div className="px-4 py-2 text-[11px] text-muted-foreground bg-muted/20 border-t">
                    แสดง 80 จาก {filtered.length} รายการ
                  </div>
                )}
              </div>
            )}
            {view === "calendar" && (
              <CalendarOverlay history={filtered} colorByAsset={colorByAsset} gran={gran} setGran={setGran} />
            )}
          </>
        );
      })()}

      {/* Simulators — What-if Analysis */}
      <div className="rounded-xl border bg-card">
        <div className="border-b p-4">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <h3 className="font-semibold text-sm">เครื่องมือจำลองสถานการณ์ (What-if Analysis)</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            ลองปรับค่าด้านล่างเพื่อดูว่า <strong>ถ้าทำแบบนี้ในอนาคต ผลจะเป็นยังไง</strong> — ตัวเลขคำนวณจากประวัติจริงของป้ายที่เลือก
            ค่าที่ได้คือการ <strong>คาดการณ์</strong> เพื่อช่วยตัดสินใจ ไม่ใช่ค่าจริงในระบบ
          </p>
        </div>

        <div className="grid gap-px bg-border lg:grid-cols-3">
          {/* PM Frequency */}
          {(() => {
            const better = pmFreqDays < baselinePm;
            const same = Math.round(pmFreqDays) === Math.round(baselinePm);
            const status = same ? "neutral" : better ? "better" : "worse";
            return (
              <div className="bg-card p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Wrench className="size-4 text-primary" />
                  <h4 className="font-semibold text-sm">ถ้าทำ PM ถี่ขึ้น/ห่างขึ้น</h4>
                </div>
                {!hasPmData ? (
                  <div className="mt-2 rounded-lg border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground mb-1">⚠︎ ไม่สามารถจำลองได้</div>
                    ป้ายที่เลือก<strong> ยังไม่เคยทำ PM </strong>
                    (หรือมีน้อยกว่า 2 ครั้ง — ตอนนี้พบ {totalPm} ครั้ง)
                    จึงคำนวณ "PM เฉลี่ยทุกกี่วัน" จากของจริงไม่ได้
                    <div className="mt-2 text-foreground">เลือกป้ายที่มีประวัติ PM ≥ 2 ครั้ง หรือเปลี่ยนช่วงวันที่ให้ครอบคลุมประวัติเดิม</div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mb-3">
                      ปัจจุบันทำ PM เฉลี่ยทุก <strong className="text-foreground">{baselinePm.toFixed(0)} วัน</strong>
                      <span className="text-[10px] ml-1">(จาก {totalPm} ครั้ง)</span> · ลองเปลี่ยนความถี่ใหม่
                    </p>
                    <input type="range" min={7} max={120} step={1} value={pmFreqDays} onChange={(e) => setPmFreqDays(Number(e.target.value))} className="w-full" />
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">ถี่ขึ้น (7 วัน)</span>
                      <span className="font-medium">PM ทุก {pmFreqDays} วัน</span>
                      <span className="text-muted-foreground">ห่างขึ้น (120 วัน)</span>
                    </div>
                    <div className={cn(
                      "mt-3 rounded-lg p-3 text-sm",
                      status === "better" && "bg-success/10 text-success",
                      status === "worse" && "bg-destructive/10 text-destructive",
                      status === "neutral" && "bg-muted text-muted-foreground",
                    )}>
                      <div className="text-xs font-medium opacity-80">
                        {status === "better" ? "🟢 สถานการณ์ดีขึ้น" : status === "worse" ? "🔴 สถานการณ์แย่ลง" : "⚪ เท่าเดิม"}
                      </div>
                      <div className="mt-1">
                        คาด Claim {better ? "ลดลง" : "เพิ่มขึ้น"} <strong className="text-base">{Math.abs(reduction).toFixed(0)}%</strong>
                      </div>
                    </div>
                    <details className="mt-2 text-[11px] text-muted-foreground">
                      <summary className="cursor-pointer text-foreground font-medium">📐 วิธีคำนวณ & ที่มาของตัวเลข</summary>
                      <div className="mt-2 space-y-1.5">
                        <div><strong className="text-foreground">สูตร:</strong> <code>คาด Claim ลด% = (PM ปัจจุบัน − PM ใหม่) ÷ PM ปัจจุบัน × 60%</code> (เพดานไม่เกิน 80%)</div>
                        <div className="pt-1"><strong className="text-foreground">ตัวอย่างตัวเลขจริง:</strong> PM ปัจจุบัน = {baselinePm.toFixed(0)} วัน, PM ใหม่ = {pmFreqDays} วัน → ({baselinePm.toFixed(0)}−{pmFreqDays}) ÷ {baselinePm.toFixed(0)} × 60% = <strong>{reduction.toFixed(0)}%</strong></div>
                        <div className="pt-1"><strong className="text-foreground">ทำไม 60%?</strong> เป็น "ค่าสัมประสิทธิ์ประสิทธิภาพ PM" จากงานวิจัย Reliability-Centered Maintenance (RCM) ที่ระบุว่า การเพิ่มความถี่ PM 1 เท่า ลด failure rate ได้ประมาณ 50–70% ไม่ใช่ 100% เพราะมีสาเหตุที่ PM ไม่ครอบคลุม (เช่น ฟ้าผ่า, ของเสียจากโรงงาน) เราเลือกค่ากลาง 60%</div>
                        <div><strong className="text-foreground">ทำไมเพดาน 80%?</strong> ป้องกันค่าเกินจริง — แม้ PM ทุกวันก็ไม่มีทางลด Claim ได้ 100% เพราะมี random failure ที่ PM ป้องกันไม่ได้ (กฎ Bathtub Curve)</div>
                        <div><strong className="text-foreground">ข้อจำกัด:</strong> เป็นการประมาณเชิงเส้น สมมติว่า PM แต่ละครั้งมีคุณภาพเท่ากัน ค่าจริงอาจต่างถ้าคุณภาพ PM ไม่สม่ำเสมอ</div>
                      </div>
                    </details>
                  </>
                )}
              </div>
            );
          })()}

          {/* Maintenance Debt */}
          {(() => {
            const status = debtMonths === 0 ? "neutral" : "worse";
            return (
              <div className="bg-card p-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="size-4 text-warning" />
                  <h4 className="font-semibold text-sm">ถ้าเลื่อน PM ออกไป (หนี้บำรุงรักษา)</h4>
                </div>
                {!hasClaimData ? (
                  <div className="mt-2 rounded-lg border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground mb-1">⚠︎ ไม่สามารถจำลองได้</div>
                    ป้ายที่เลือก<strong> ยังไม่มี Claim ≥ 2 ครั้ง </strong>
                    (ตอนนี้พบ {totalClaim} ครั้ง) จึงไม่รู้ MTBF (ระยะเวลาเฉลี่ยระหว่างเสีย)
                    <div className="mt-2 text-foreground">การจำลอง "เลื่อน PM แล้วจะเสียเพิ่มกี่ครั้ง" ต้องอ้างอิงจาก MTBF จริง</div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mb-3">
                      MTBF จริง <strong className="text-foreground">{effMtbf.toFixed(0)} วัน</strong>
                      <span className="text-[10px] ml-1">(จาก {totalClaim} Claim)</span> · ลองเลื่อน PM ดู
                    </p>
                    <input type="range" min={0} max={6} step={1} value={debtMonths} onChange={(e) => setDebtMonths(Number(e.target.value))} className="w-full" />
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">ทำตรงเวลา</span>
                      <span className="font-medium">เลื่อน {debtMonths} เดือน</span>
                      <span className="text-muted-foreground">เลื่อน 6 เดือน</span>
                    </div>
                    <div className={cn(
                      "mt-3 rounded-lg p-3 text-sm",
                      status === "worse" && "bg-destructive/10 text-destructive",
                      status === "neutral" && "bg-success/10 text-success",
                    )}>
                      <div className="text-xs font-medium opacity-80">
                        {status === "neutral" ? "🟢 อยู่ในแผน" : "🔴 มีความเสี่ยง"}
                      </div>
                      <div className="mt-1">
                        คาดป้ายจะเสียเพิ่ม <strong className="text-base">{expectedExtraFailures}</strong> ครั้ง (รวมทุกป้ายที่เลือก)
                      </div>
                    </div>
                    <details className="mt-2 text-[11px] text-muted-foreground">
                      <summary className="cursor-pointer text-foreground font-medium">📐 วิธีคำนวณ & ที่มาของตัวเลข</summary>
                      <div className="mt-2 space-y-1.5">
                        <div><strong className="text-foreground">สูตร:</strong> <code>คาดเสียเพิ่ม = (เดือนที่เลื่อน × 30 วัน) ÷ MTBF × จำนวนป้าย</code></div>
                        <div className="pt-1"><strong className="text-foreground">ตัวอย่างตัวเลขจริง:</strong> เลื่อน {debtMonths} เดือน × 30 วัน = {debtMonths * 30} วัน, MTBF = {effMtbf.toFixed(0)} วัน, ป้าย {assets.length} ตัว → {debtMonths * 30} ÷ {effMtbf.toFixed(0)} × {assets.length} = <strong>{expectedExtraFailures} ครั้ง</strong></div>
                        <div className="pt-1"><strong className="text-foreground">ทำไม 30 วัน?</strong> เป็นการแปลง "เดือน" เป็น "วัน" แบบมาตรฐาน (1 เดือน ≈ 30 วัน) เพื่อให้หน่วยตรงกับ MTBF ที่นับเป็น "วัน"</div>
                        <div><strong className="text-foreground">ทำไมหารด้วย MTBF?</strong> MTBF (Mean Time Between Failure) = ระยะเวลาเฉลี่ยระหว่าง Claim 2 ครั้งติดกัน ถ้า MTBF = 10 วัน แปลว่าทุก 10 วันจะมี Claim 1 ครั้ง → ในช่วง 30 วันที่เลื่อนออกไปจะมี Claim เพิ่ม = 30÷10 = 3 ครั้ง ต่อป้าย 1 ตัว</div>
                        <div><strong className="text-foreground">ที่มา MTBF:</strong> คำนวณจากประวัติ Claim จริงของป้ายที่เลือก ({totalClaim} ครั้ง) — เรียงตามเวลา → หาช่วงห่างเฉลี่ยระหว่างคู่ติดกัน</div>
                        <div><strong className="text-foreground">ข้อจำกัด:</strong> สมมติว่า Claim เกิดสม่ำเสมอ (Poisson distribution) ค่าจริงอาจกระจุกตัวมากกว่าโดยเฉพาะหน้าฝน</div>
                      </div>
                    </details>
                  </>
                )}
              </div>
            );
          })()}

          {/* Service Level — interactive */}
          {(() => {
            const status = projAvailability >= 95 ? "better" : projAvailability >= 80 ? "neutral" : "worse";
            const trend = availDelta > 0.1 ? "better" : availDelta < -0.1 ? "worse" : "neutral";
            return (
              <div className="bg-card p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="size-4 text-primary" />
                  <h4 className="font-semibold text-sm">ถ้าตอบสนอง Claim เร็ว/ช้าลง</h4>
                </div>
                {!hasResponseData ? (
                  <div className="mt-2 rounded-lg border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground mb-1">⚠︎ ไม่สามารถจำลองได้</div>
                    ต้องมีประวัติ <strong>Claim ≥ 2 ครั้ง</strong> พร้อมเวลา response จึงคำนวณ Availability จริงได้
                    <div className="mt-2 text-foreground">ตอนนี้พบ Claim {totalClaim} ครั้ง · มีเวลา response ที่ใช้ได้ {avgResponse > 0 ? "" : "0"} ค่า</div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mb-3">
                      ปัจจุบันตอบสนองเฉลี่ย <strong className="text-foreground">{curResponse.toFixed(1)} ชม.</strong> · ลองปรับเป้าหมายใหม่
                    </p>
                    <input type="range" min={1} max={72} step={1} value={targetResponse} onChange={(e) => setTargetResponse(Number(e.target.value))} className="w-full" />
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">ตอบเร็ว 1 ชม.</span>
                      <span className="font-medium">เป้าหมาย {targetResponse} ชม.</span>
                      <span className="text-muted-foreground">ตอบช้า 72 ชม.</span>
                    </div>
                    <div className={cn(
                      "mt-3 rounded-lg p-3 text-center",
                      status === "better" && "bg-success/10 text-success",
                      status === "neutral" && "bg-warning/10 text-[oklch(0.45_0.15_75)]",
                      status === "worse" && "bg-destructive/10 text-destructive",
                    )}>
                      <div className="text-3xl font-bold">{projAvailability.toFixed(1)}%</div>
                      <div className="text-xs mt-0.5">
                        Availability ที่คาด — {status === "better" ? "🟢 ดีมาก (≥95%)" : status === "neutral" ? "🟡 พอใช้ (80–95%)" : "🔴 ต้องปรับปรุง (<80%)"}
                      </div>
                      <div className="text-[11px] mt-1 opacity-80">
                        เทียบกับปัจจุบัน {availability.toFixed(1)}%: {trend === "better" ? `🟢 ดีขึ้น +${availDelta.toFixed(1)}%` : trend === "worse" ? `🔴 แย่ลง ${availDelta.toFixed(1)}%` : "⚪ เท่าเดิม"}
                      </div>
                    </div>
                    <details className="mt-2 text-[11px] text-muted-foreground">
                      <summary className="cursor-pointer text-foreground font-medium">📐 วิธีคำนวณ & ที่มาของตัวเลข</summary>
                      <div className="mt-2 space-y-1.5">
                        <div><strong className="text-foreground">สูตร Availability:</strong> <code>100 − (เวลาตอบสนองเป้าหมาย ÷ (MTBF × 24)) × 100</code> (หน่วย %)</div>
                        <div className="pt-1"><strong className="text-foreground">ตัวอย่างตัวเลขจริง:</strong> เป้าหมาย = {targetResponse} ชม., MTBF = {effMtbf.toFixed(0)} วัน × 24 = {(effMtbf * 24).toFixed(0)} ชม. → 100 − ({targetResponse} ÷ {(effMtbf * 24).toFixed(0)}) × 100 = <strong>{projAvailability.toFixed(1)}%</strong></div>
                        <div className="pt-1"><strong className="text-foreground">ทำไม × 24?</strong> เพราะ MTBF ของระบบเรานับเป็น "วัน" แต่ "เวลาตอบสนอง Claim" นับเป็น "ชั่วโมง" — ต้องแปลงหน่วยให้ตรงกัน (1 วัน = 24 ชั่วโมง) ก่อนหารกัน</div>
                        <div><strong className="text-foreground">แนวคิด:</strong> Availability = อัตราเวลาที่ป้าย "ใช้งานได้" จากเวลาทั้งหมด สมการมาตรฐานอุตสาหกรรม คือ <code>Uptime ÷ (Uptime + Downtime)</code> โดย Uptime ≈ MTBF และ Downtime ≈ MTTR (เวลาตอบสนอง+ซ่อม)</div>
                        <div><strong className="text-foreground">เกณฑ์มาตรฐาน:</strong> ≥95% = ดีเยี่ยม (Tier-1 SLA), 80–95% = พอใช้, &lt;80% = ต้องปรับปรุงเร่งด่วน (อ้างอิง ITIL Service Availability)</div>
                        <div><strong className="text-foreground">ข้อจำกัด:</strong> สูตรย่อ ไม่รวมเวลา PM ที่วางแผนล่วงหน้า (planned downtime) จริงๆ ค่าจริงอาจสูงกว่านี้เล็กน้อย</div>
                      </div>
                    </details>
                  </>
                )}
              </div>
            );
          })()}
        </div>

      </div>
    </div>
  );
}

// Calendar — monthly view with prev/next navigation, plus yearly overview
function CalendarOverlay({
  history,
  colorByAsset: _c,
  gran,
  setGran,
}: {
  history: HistRow[];
  colorByAsset: Map<string, string>;
  gran: "month" | "year";
  setGran: (g: "month" | "year") => void;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const typeColor = (t: string) =>
    t === "Claim" ? "oklch(0.6 0.22 25)"
    : t === "PM" ? "oklch(0.62 0.19 255)"
    : t === "PMSchedule" ? "oklch(0.72 0.17 60)"
    : "oklch(0.65 0.16 155)";
  const typeLetter = (t: string) => t === "Claim" ? "C" : t === "PM" ? "P" : t === "PMSchedule" ? "S" : "M";
  const thMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

  // ===== Year view =====
  if (gran === "year") {
    const yearKey = String(year);
    const yearEvents = history.filter((h) => eventDate(h)?.startsWith(yearKey));
    const buddhistYear = year + 543;
    const months = Array.from({ length: 12 }, (_, m) => {
      const mk = `${year}-${String(m + 1).padStart(2, "0")}`;
      const evs = yearEvents.filter((h) => eventDate(h)?.startsWith(mk));
      const pm = evs.filter((e) => e.type === "PM").length;
      const claim = evs.filter((e) => e.type === "Claim").length;
      const monitor = evs.filter((e) => e.type === "Monitor").length;
      const sched = evs.filter((e) => e.type === "PMSchedule").length;
      return { m, label: thMonths[m], total: evs.length, pm, claim, monitor, sched };
    });
    const maxTotal = Math.max(1, ...months.map((x) => x.total));

    return (
      <div className="rounded-xl border p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <CalIcon className="size-4" /> Maintenance Calendar — ภาพรวมรายปี
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border overflow-hidden">
              <button onClick={() => setGran("month")} className="px-3 py-1 text-xs bg-background hover:bg-accent">รายเดือน</button>
              <button onClick={() => setGran("year")} className="px-3 py-1 text-xs bg-primary text-primary-foreground">รายปี</button>
            </div>
            <button onClick={() => setCursor(new Date(year - 1, 0, 1))} className="px-2.5 py-1 rounded-md border bg-background hover:bg-accent text-sm" aria-label="ปีก่อนหน้า">‹</button>
            <button onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))} className="px-3 py-1 rounded-md border bg-background hover:bg-accent text-xs">ปีนี้</button>
            <div className="min-w-[6rem] text-center text-sm font-medium tabular-nums">พ.ศ. {buddhistYear}</div>
            <button onClick={() => setCursor(new Date(year + 1, 0, 1))} className="px-2.5 py-1 rounded-md border bg-background hover:bg-accent text-sm" aria-label="ปีถัดไป">›</button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {months.map((mo) => {
            const isCurrent = mo.m === today.getMonth() && year === today.getFullYear();
            return (
              <button
                key={mo.m}
                onClick={() => { setCursor(new Date(year, mo.m, 1)); setGran("month"); }}
                className={cn(
                  "text-left rounded-lg border bg-background p-3 hover:bg-accent transition-colors",
                  isCurrent && "border-primary ring-1 ring-primary/30",
                )}
                title={`${mo.label} ${buddhistYear} — รวม ${mo.total} รายการ`}
              >
                <div className="flex items-baseline justify-between mb-2">
                  <div className={cn("text-sm font-semibold", isCurrent && "text-primary")}>{mo.label}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">{mo.total}</div>
                </div>
                {/* stacked intensity bar */}
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
                  {mo.total > 0 ? (
                    <>
                      <div style={{ width: `${(mo.pm / mo.total) * 100}%`, background: typeColor("PM") }} />
                      <div style={{ width: `${(mo.claim / mo.total) * 100}%`, background: typeColor("Claim") }} />
                      <div style={{ width: `${(mo.monitor / mo.total) * 100}%`, background: typeColor("Monitor") }} />
                      <div style={{ width: `${(mo.sched / mo.total) * 100}%`, background: typeColor("PMSchedule") }} />
                    </>
                  ) : null}
                </div>
                {/* intensity hint */}
                <div className="mt-1 h-1 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary/40" style={{ width: `${(mo.total / maxTotal) * 100}%` }} />
                </div>
                <div className="mt-2 flex gap-2 text-[11px] tabular-nums">
                  <span style={{ color: typeColor("PM") }}>P {mo.pm}</span>
                  <span style={{ color: typeColor("Claim") }}>C {mo.claim}</span>
                  <span style={{ color: typeColor("Monitor") }}>M {mo.monitor}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[oklch(0.62_0.19_255)]" /> PM</span>
            <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[oklch(0.6_0.22_25)]" /> Claim</span>
            <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[oklch(0.65_0.16_155)]" /> Monitor</span>
          </div>
          <div className="text-xs text-muted-foreground">รวมทั้งปี {yearEvents.length} รายการ • คลิกที่เดือนเพื่อดูรายละเอียด</div>
        </div>
      </div>
    );
  }

  // ===== Month view =====
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = cursor.toLocaleDateString("th-TH", { year: "numeric", month: "long" });
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthEvents = history.filter((h) => eventDate(h)?.startsWith(monthKey));
  const todayKey = new Date().toISOString().slice(0, 10);

  const cells: { date: string | null; day: number | null; events: HistRow[] }[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ date: null, day: null, events: [] });
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ date: key, day: d, events: monthEvents.filter((h) => eventDate(h)?.slice(0, 10) === key) });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null, events: [] });

  const dows = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-sm font-medium flex items-center gap-2">
          <CalIcon className="size-4" /> Maintenance Calendar
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border overflow-hidden">
            <button onClick={() => setGran("month")} className="px-3 py-1 text-xs bg-primary text-primary-foreground">รายเดือน</button>
            <button onClick={() => setGran("year")} className="px-3 py-1 text-xs bg-background hover:bg-accent">รายปี</button>
          </div>
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="px-2.5 py-1 rounded-md border bg-background hover:bg-accent text-sm" aria-label="เดือนก่อนหน้า">‹</button>
          <button onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))} className="px-3 py-1 rounded-md border bg-background hover:bg-accent text-xs">วันนี้</button>
          <div className="min-w-[10rem] text-center text-sm font-medium tabular-nums">{monthLabel}</div>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="px-2.5 py-1 rounded-md border bg-background hover:bg-accent text-sm" aria-label="เดือนถัดไป">›</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {dows.map((d) => (
          <div key={d} className="text-[11px] text-muted-foreground text-center py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c.date) return <div key={i} className="h-16 rounded border border-dashed border-border/40 bg-muted/20" />;
          const isToday = c.date === todayKey;
          return (
            <div
              key={c.date}
              className={cn("h-16 rounded border bg-background p-1 relative flex flex-col", isToday && "border-primary ring-1 ring-primary/30")}
              title={`${c.date} — ${c.events.length} รายการ`}
            >
              <div className={cn("text-[10px] leading-none", isToday ? "font-semibold text-primary" : "text-muted-foreground")}>{c.day}</div>
              {c.events.length > 0 && (
                <div className="mt-auto flex flex-col gap-0.5 overflow-hidden">
                  {c.events.slice(0, 2).map((e) => {
                    const thDate = e.opened_at ? new Date(e.opened_at).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : "";
                    return (
                      <span
                        key={e.id}
                        className="inline-flex items-center gap-1 rounded px-1 py-px text-[9px] font-medium leading-tight text-white truncate"
                        style={{ background: typeColor(e.type) }}
                        title={`${thDate} • ${e.type} • ${e.asset_old_code}${e.status ? " • " + e.status : ""}`}
                      >
                        <span className="opacity-80 shrink-0">{e.type === "Claim" ? "C" : e.type === "PM" ? "P" : "M"}</span>
                        <span className="truncate">{e.asset_old_code}</span>
                      </span>
                    );
                  })}
                  {c.events.length > 2 && (
                    <span className="text-[9px] text-muted-foreground leading-none">+{c.events.length - 2}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[oklch(0.62_0.19_255)]" /> PM</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[oklch(0.6_0.22_25)]" /> Claim</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[oklch(0.65_0.16_155)]" /> Monitor</span>
        </div>
        <div className="text-xs text-muted-foreground">รวม {monthEvents.length} รายการในเดือนนี้</div>
      </div>
    </div>
  );
}

// ============ Profile Tab ============
type ProfileItem = {
  asset: {
    id: string; old_code: string; name: string | null;
    department: string | null; area: string | null; status: string | null;
    latitude: number | null; longitude: number | null;
    payload: unknown;
  };
  status: string;
  statusTone: "ok" | "warning" | "danger";
  claim: { title: string | null; severity: string | null; sla_status: string | null; opened_at: string | null } | null;
  lat: number | null;
  lng: number | null;
  monthly: Array<{ month: string; PM: number; Claim: number }>;
};

const PROFILE_FIELD_ORDER = [
  "OldCode", "EquipmentID", "Description", "Location", "District", "Territory",
  "Region", "BKKUPC", "Department", "MediaType", "MediaClass", "MediaSegment",
  "RoutePM", "RouteMonitoring", "RouteReportPhoto", "RouteInstallAndDemolish",
  "TargetMonitoring", "Extra_1", "Extra_2", "Extra_3",
];
// ฟิลด์เหล่านี้ไม่แสดงในหน้า Profile ตามคำสั่งผู้ใช้ (ค่า meta ภายในระบบ)
const PROFILE_HIDDEN_FIELDS = new Set([
  "CreatedDateTime", "UpdatedDateTime", "Id", "IsDeleted",
  "createdDateTime", "updatedDateTime", "id", "isDeleted",
  "ID", "ISDELETED", "CREATEDDATETIME", "UPDATEDDATETIME",
]);

function ProfileTab({ profiles }: { profiles: ProfileItem[] }) {
  if (!profiles.length) {
    return <div className="py-10 text-center text-sm text-muted-foreground">ไม่พบข้อมูลป้าย</div>;
  }
  return (
    <div className="space-y-8">
      {profiles.map((p) => <ProfileCard key={p.asset.id} p={p} />)}
    </div>
  );
}

function ProfileCard({ p }: { p: ProfileItem }) {
  const payload = (p.asset.payload && typeof p.asset.payload === "object" ? p.asset.payload : {}) as Record<string, unknown>;
  const fields: Array<{ k: string; v: string }> = [];
  const seen = new Set<string>(["OldCode"]);
  for (const k of PROFILE_FIELD_ORDER) {
    if (k === "OldCode" || PROFILE_HIDDEN_FIELDS.has(k)) continue;
    const v = (payload as Record<string, unknown>)[k];
    if (v == null || v === "") continue;
    fields.push({ k, v: String(v) });
    seen.add(k);
  }
  for (const k of Object.keys(payload)) {
    if (seen.has(k) || PROFILE_HIDDEN_FIELDS.has(k)) continue;
    const v = (payload as Record<string, unknown>)[k];
    if (v == null || v === "" || typeof v === "object") continue;
    fields.push({ k, v: String(v) });
  }

  const toneCls =
    p.statusTone === "ok" ? "bg-emerald-100 text-emerald-700 border-emerald-300"
    : p.statusTone === "danger" ? "bg-red-100 text-red-700 border-red-300"
    : "bg-amber-100 text-amber-800 border-amber-300";

  const totalPM = p.monthly.reduce((s, m) => s + m.PM, 0);
  const totalClaim = p.monthly.reduce((s, m) => s + m.Claim, 0);

  const mapSrc = p.lat != null && p.lng != null
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${p.lng - 0.005},${p.lat - 0.005},${p.lng + 0.005},${p.lat + 0.005}&layer=mapnik&marker=${p.lat},${p.lng}`
    : null;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Header — Old Code most prominent + status */}
      <div className="px-5 py-4 border-b bg-gradient-to-r from-primary/5 to-transparent flex items-center gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Old Code</div>
          <div className="font-mono text-3xl font-bold tracking-tight text-primary">{p.asset.old_code}</div>
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="text-sm font-medium truncate">{p.asset.name ?? "—"}</div>
          <div className="text-xs text-muted-foreground truncate">
            {[p.asset.department, p.asset.area].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full border", toneCls)}>
          <span className="size-2 rounded-full bg-current opacity-70" />
          {p.status}
        </span>
      </div>

      {/* Field grid */}
      <div className="p-5 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 border-b">
        {fields.map((f) => (
          <div key={f.k} className="min-w-0">
            <div className="text-[11px] uppercase text-muted-foreground tracking-wide">{f.k}</div>
            <div className="text-sm break-words">{f.v}</div>
          </div>
        ))}
        {fields.length === 0 && (
          <div className="text-sm text-muted-foreground col-span-full">ไม่มีข้อมูลเพิ่มเติม</div>
        )}
      </div>

      {/* Monthly counts */}
      <div className="p-5 grid gap-4 lg:grid-cols-2 border-b">
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">PM ย้อนหลัง 12 เดือน</div>
            <div className="text-xs text-muted-foreground">รวม {totalPM} ครั้ง</div>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={p.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0 0)" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <RTooltip />
                <Bar dataKey="PM" fill={TYPE_COLOR.PM} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">Claim ย้อนหลัง 12 เดือน</div>
            <div className="text-xs text-muted-foreground">รวม {totalClaim} ครั้ง</div>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={p.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0 0)" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <RTooltip />
                <Bar dataKey="Claim" fill={TYPE_COLOR.Claim} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium inline-flex items-center gap-2">
            <MapPin className="size-4" /> ตำแหน่งป้าย
          </div>
          {p.lat != null && p.lng != null && (
            <a
              href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
              target="_blank" rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              เปิดใน Google Maps ↗
            </a>
          )}
        </div>
        {mapSrc ? (
          <div className="rounded-lg overflow-hidden border h-[26rem]">
            <iframe
              key={`${p.lat},${p.lng}`}
              title={`map-${p.asset.old_code}`}
              src={mapSrc}
              className="w-full h-full"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="rounded-lg border bg-muted/30 h-40 grid place-items-center text-sm text-muted-foreground">
            ไม่มีข้อมูลพิกัด (latitude/longitude)
          </div>
        )}
      </div>
    </div>
  );
}

function PmScheduleTab({ rows }: { rows: PmScheduleRow[] }) {
  if (!rows.length) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        ยังไม่มีข้อมูล PM Schedule สำหรับป้ายที่เลือก — ป้ายนี้อาจยังไม่มี PM Schedule ใน Modern Corporate Server หรือยังไม่ได้ Sync (กด "ทดสอบดึงข้อมูล Asset" ในหน้าตั้งค่า)
      </div>
    );
  }

  // Summary across all rows
  const statuses = rows.map(computePmSchedStatus);
  const approvedCount = statuses.filter((s) => s.kind === "approved").length;
  const finishedCount = statuses.filter((s) => s.kind === "finished").length;
  const workingCount = statuses.filter((s) => s.kind === "working").length;
  const overdueCount = statuses.filter((s) => s.kind === "overdue").length;
  const upcomingCount = statuses.filter((s) => s.kind === "upcoming").length;
  const pendingCount = statuses.filter((s) => s.kind === "pending").length;
  const maxOverdue = statuses.reduce((m, s) => (s.kind === "overdue" && s.days > m ? s.days : m), 0);

  // Latest done per asset (รวม Finished + Approved)
  const latestDoneByAsset = new Map<string, string>();
  rows.forEach((r, i) => {
    const s = statuses[i];
    if (!(s.kind === "approved" || s.kind === "finished") || !r.asset_old_code) return;
    const d = s.doneDate;
    if (!d) return;
    const prev = latestDoneByAsset.get(r.asset_old_code);
    if (!prev || new Date(d).getTime() > new Date(prev).getTime()) {
      latestDoneByAsset.set(r.asset_old_code, d);
    }
  });

  const stageBadge = (s: PmSchedStatus) => {
    if (s.kind === "approved") return <Badge tone="success">หัวหน้าอนุมัติแล้ว · {fmtDate(s.doneDate)}</Badge>;
    if (s.kind === "finished") return <Badge tone="info">ทำเสร็จ รอตรวจ · {fmtDate(s.doneDate)}</Badge>;
    if (s.kind === "working") return <Badge tone="warning">กำลังทำงาน{s.updatedAt ? ` · อัพเดท ${fmtDate(s.updatedAt)}` : ""}</Badge>;
    if (s.kind === "overdue") return <Badge tone="danger">เกินกำหนด {s.days} วัน</Badge>;
    if (s.kind === "upcoming") return <Badge tone="warning">อีก {s.days} วัน</Badge>;
    if (s.kind === "pending") return <Badge tone="default">รอจ่ายงาน</Badge>;
    return <span className="text-muted-foreground">—</span>;
  };

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">ทั้งหมด</div>
          <div className="text-2xl font-semibold">{rows.length}</div>
        </div>
        <div className="rounded-lg border bg-success/5 p-3">
          <div className="text-xs text-success">Approved</div>
          <div className="text-2xl font-semibold text-success">{approvedCount}</div>
          <div className="text-[10px] text-muted-foreground">หัวหน้าตรวจผ่านแล้ว</div>
        </div>
        <div className="rounded-lg border bg-primary/5 p-3">
          <div className="text-xs text-primary">Finished</div>
          <div className="text-2xl font-semibold text-primary">{finishedCount}</div>
          <div className="text-[10px] text-muted-foreground">รอหัวหน้าตรวจ</div>
        </div>
        <div className="rounded-lg border bg-warning/5 p-3">
          <div className="text-xs text-warning-foreground">Working On</div>
          <div className="text-2xl font-semibold">{workingCount}</div>
          <div className="text-[10px] text-muted-foreground">กำลังทำงาน</div>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground">Pending / รอถึงกำหนด</div>
          <div className="text-2xl font-semibold">{pendingCount + upcomingCount}</div>
        </div>
        <div className="rounded-lg border bg-destructive/5 p-3">
          <div className="text-xs text-destructive">เกินกำหนด</div>
          <div className="text-2xl font-semibold text-destructive">{overdueCount}</div>
          {maxOverdue > 0 && (
            <div className="text-[11px] text-destructive/80 mt-0.5">สูงสุด {maxOverdue} วัน</div>
          )}
        </div>
      </div>

      <div className="rounded-md border border-dashed bg-muted/20 p-3 text-[11px] text-muted-foreground leading-relaxed">
        <b>คำอธิบายสถานะ:</b> <Badge tone="default">Pending</Badge> = รอจ่ายงาน · <Badge tone="warning">Working On</Badge> = ช่างเข้าหน้างานแล้ว ·
        <Badge tone="info">Finished</Badge> = ช่างทำเสร็จ รอหัวหน้าตรวจ · <Badge tone="success">Approved</Badge> = หัวหน้าตรวจผ่านแล้ว
        <div className="mt-1"><b>Schedule Date</b> = วันที่นัดเข้าทำงาน · <b>Asset Update Date</b> = วันล่าสุดที่มีการอัพเดทสถานะ</div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Project</th>
              <th className="px-3 py-2 text-left">ป้าย (OldCode)</th>
              <th className="px-3 py-2 text-left">Ref Number</th>
              <th className="px-3 py-2 text-left">Schedule Date</th>
              <th className="px-3 py-2 text-left">Asset Update Date</th>
              <th className="px-3 py-2 text-left">สถานะการทำ</th>
              <th className="px-3 py-2 text-left">Status (ดิบ)</th>
              <th className="px-3 py-2 text-left">Inform Position</th>
              <th className="px-3 py-2 text-left">Asset Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const s = statuses[i];
              const updatedAt = getAssetUpdateDate(r);
              return (
                <tr key={r.id} className="border-t hover:bg-accent/30">
                  <td className="px-3 py-2">{r.project ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.asset_old_code ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.ref_number ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.schedule_date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(updatedAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{stageBadge(s)}</td>
                  <td className="px-3 py-2">{r.status ?? "—"}</td>
                  <td className="px-3 py-2">{r.inform_position ?? "—"}</td>
                  <td className="px-3 py-2">{r.asset_status ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {latestDoneByAsset.size > 0 && (
        <div className="text-[11px] text-muted-foreground">
          PM Schedule ล่าสุดที่ทำแล้ว: {Array.from(latestDoneByAsset.entries()).map(([c, d]) => `${c} (${fmtDate(d)})`).join(" · ")}
        </div>
      )}
    </div>
  );
}
