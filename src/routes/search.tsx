import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Search, RefreshCw, MapPin, Building2, X, Plus, ChevronDown,
  Activity, AlertCircle, Wrench, Eye, Calendar as CalIcon,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { PageHeader, Badge, StatCard } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { autocompleteAssets, getAssetsComparison } from "@/lib/data.functions";
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
  { id: "PM", label: "PM", icon: Wrench },
  { id: "Claim", label: "Claim", icon: AlertCircle },
  { id: "Monitor", label: "Monitoring", icon: Eye },
  { id: "AssetHealth", label: "Asset Health", icon: Activity },
] as const;
type TabId = typeof TABS[number]["id"];

const RECENT_KEY = "asset-search-recent";
const MAX_SLOTS = 5;
const PALETTE = [
  "oklch(0.62 0.19 255)",
  "oklch(0.65 0.16 155)",
  "oklch(0.7 0.18 50)",
  "oklch(0.6 0.22 25)",
  "oklch(0.55 0.2 305)",
];
// สีเดียวกันทั้งระบบต่อ "ประเภทงาน" — PM / Claim / Monitor
const TYPE_COLOR: Record<"PM" | "Claim" | "Monitor", string> = {
  PM: "oklch(0.62 0.19 255)",      // น้ำเงิน
  Claim: "oklch(0.6 0.22 25)",     // แดง
  Monitor: "oklch(0.65 0.16 155)", // เขียว
};
// รูปแบบเส้นแยกตามป้าย (สูงสุด 5 slots)
const ASSET_DASH = ["", "6 3", "2 3", "8 3 2 3", "4 2 1 2"];

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

// ---------- Slot Combobox ----------
function SlotCombobox({
  value, onPick, onClear, color,
}: { value: string | null; onPick: (code: string) => void; onClear: () => void; color: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q, 250);
  const autoFn = useServerFn(autocompleteAssets);
  const { data: ac, isFetching } = useQuery({
    queryKey: ["autocomplete", debounced],
    queryFn: () => autoFn({ data: { q: debounced, limit: 15 } }),
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
  const [tab, setTab] = useState<TabId>("PM");
  const [from, setFrom] = useState("2026-01-01");
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [dept, setDept] = useState("");
  const [region, setRegion] = useState("");
  const [mediaType, setMediaType] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [healthSel, setHealthSel] = useState<{ PM: boolean; Claim: boolean; Monitor: boolean }>({ PM: true, Claim: true, Monitor: true });
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
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["comparison", codes.join(","), tab, fromIso, toIso, dept, region, mediaType],
    queryFn: () => cmpFn({
      data: {
        oldCodes: codes,
        tab,
        from: fromIso,
        to: toIso,
        department: dept || undefined,
        region: region || undefined,
        mediaType: mediaType || undefined,
      },
    }),
    enabled: codes.length > 0,
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
    const p = cmpFn({ data: { oldCodes: codes, tab, from: fromIso, to: toIso, forceSync: true } }).then(() => refetch());
    p.finally(() => { inFlightRef.current = false; });
    toast.promise(p, { loading: "กำลังดึงประวัติจาก PlanB...", success: "ซิงค์ประวัติสำเร็จ", error: (e) => `ซิงค์ไม่สำเร็จ: ${e?.message ?? e}` });
  }

  const assets = data?.assets ?? [];
  const history = data?.history ?? [];
  const slicers = data?.slicers ?? { departments: [], regions: [], mediaTypes: [] };

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

      {/* Slot selectors */}
      <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-card)] space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {slots.map((slot, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <SlotCombobox
                  value={slot}
                  color={PALETTE[i % PALETTE.length]}
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
          <div className="flex flex-wrap items-center gap-2 text-xs pt-1 border-t pt-3">
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

      {/* Slicers */}
      <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)] grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Slicer label="Department" value={dept} onChange={setDept} options={slicers.departments} />
        <Slicer label="BKK / UPC" value={region} onChange={setRegion} options={slicers.regions} />
        <Slicer label="Media Type" value={mediaType} onChange={setMediaType} options={slicers.mediaTypes} />
        <div>
          <label className="text-xs font-medium text-muted-foreground">วันที่เริ่ม</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">วันที่สิ้นสุด</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm" />
        </div>
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
          ) : isFetching && !data ? (
            <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
          ) : tab === "AssetHealth" ? (
            <AssetHealthTab
              assets={assets} history={history} colorByAsset={colorByAsset}
              sel={healthSel} onSel={setHealthSel}
              pmFreqDays={pmFreqDays} setPmFreqDays={setPmFreqDays}
              debtMonths={debtMonths} setDebtMonths={setDebtMonths}
            />
          ) : (
            <RegularTab
              tab={tab} assets={assets} history={history} colorByAsset={colorByAsset}
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

// ============ Regular Tab (PM/Claim/Monitor) ============
type Asset = { id: string; old_code: string; name: string | null; department: string | null; area: string | null; status: string | null };
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

  // Trend chart per asset per month
  const monthLabels = Array.from(months).sort();
  const chartData = monthLabels.map((m) => {
    const row: Record<string, string | number> = { month: m };
    for (const a of assets) {
      row[a.old_code] = history.filter((h) => h.asset_id === a.id && h.opened_at?.startsWith(m)).length;
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
          <StatCard label="Response / Resolve" value={`${Math.round(avgResponse)}h / ${Math.round(avgResolve)}h`} tone="default" />
        )}
      </div>

      {/* Trend chart */}
      {chartData.length > 0 && (
        <div className="rounded-xl border p-4">
          <div className="text-sm font-medium mb-3">แนวโน้มรายเดือน — {tab}</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0 0)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <RTooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {assets.map((a) => (
                  <Line key={a.id} type="monotone" dataKey={a.old_code} stroke={colorByAsset.get(a.id)} strokeWidth={2} dot />
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
      <div className="rounded-xl border overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b bg-muted/30">
          <div className="text-sm font-medium">ข้อมูลดิบ ({total} รายการ)</div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">แสดง</span>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="h-8 rounded border bg-background px-2 text-sm">
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5">ป้าย</th>
                <th className="text-left px-4 py-2.5">วันที่เปิด</th>
                <th className="text-left px-4 py-2.5">รายการ</th>
                <th className="text-left px-4 py-2.5">สถานะ</th>
                {tab === "Claim" && <th className="text-left px-4 py-2.5">วิธีแก้</th>}
                {tab === "Claim" && <th className="text-right px-4 py-2.5">Resp/Res (h)</th>}
                <th className="text-left px-4 py-2.5">ปิดเมื่อ</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pageRows.length === 0 ? (
                <tr><td colSpan={tab === "Claim" ? 7 : 5} className="px-4 py-8 text-center text-muted-foreground text-sm">ไม่มีข้อมูลในช่วงที่เลือก</td></tr>
              ) : pageRows.map((h) => (
                <tr key={h.id} className="hover:bg-accent/30">
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-2">
                      <span className="size-2 rounded-full" style={{ background: colorByAsset.get(h.asset_id) ?? "transparent" }} />
                      <span className="font-mono text-xs">{h.asset_old_code}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs">{fmtDate(h.opened_at)}</td>
                  <td className="px-4 py-2.5">{h.title ?? "—"}</td>
                  <td className="px-4 py-2.5"><Badge tone={/finish|approved|closed|done/i.test(h.status ?? "") ? "success" : "warning"}>{h.status ?? "—"}</Badge></td>
                  {tab === "Claim" && <td className="px-4 py-2.5 text-xs text-muted-foreground">{h.payload?.solutionCategory ?? "—"}</td>}
                  {tab === "Claim" && <td className="px-4 py-2.5 text-right text-xs tabular-nums">{Math.round(Number(h.payload?.responseTime ?? 0))}/{Math.round(Number(h.payload?.resolveTime ?? 0))}</td>}
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDateTime(h.closed_at)}</td>
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
    </div>
  );
}

// ============ Asset Health Tab ============
function AssetHealthTab({
  assets, history, colorByAsset, sel, onSel,
  pmFreqDays, setPmFreqDays, debtMonths, setDebtMonths,
}: {
  assets: Asset[]; history: HistRow[]; colorByAsset: Map<string, string>;
  sel: { PM: boolean; Claim: boolean; Monitor: boolean }; onSel: (s: typeof sel) => void;
  pmFreqDays: number; setPmFreqDays: (n: number) => void;
  debtMonths: number; setDebtMonths: (n: number) => void;
}) {
  const [view, setView] = useState<"graph" | "table" | "calendar">("graph");
  const [gran, setGran] = useState<"month" | "year">("month");
  const keyLen = gran === "month" ? 7 : 4;

  // Per-asset metrics
  const perAsset = assets.map((a) => {
    const ph = history.filter((h) => h.asset_id === a.id);
    const claims = ph.filter((h) => h.type === "Claim").map((h) => h.opened_at ? new Date(h.opened_at).getTime() : 0).filter(Boolean).sort((x, y) => x - y);
    const pms = ph.filter((h) => h.type === "PM").map((h) => h.opened_at ? new Date(h.opened_at).getTime() : 0).filter(Boolean).sort((x, y) => x - y);
    const mons = ph.filter((h) => h.type === "Monitor").map((h) => h.opened_at ? new Date(h.opened_at).getTime() : 0).filter(Boolean).sort((x, y) => x - y);
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

  // Combined trend (per bucket, per type) — granularity = month or year
  const buckets = new Set<string>();
  history.forEach((h) => { if (h.opened_at) buckets.add(h.opened_at.slice(0, keyLen)); });
  const bucketLabels = Array.from(buckets).sort();
  const chartData = bucketLabels.map((m) => {
    const row: Record<string, string | number> = { bucket: m };
    for (const a of assets) {
      if (sel.PM) row[`${a.old_code} · PM`] = history.filter((h) => h.asset_id === a.id && h.type === "PM" && h.opened_at?.startsWith(m)).length;
      if (sel.Claim) row[`${a.old_code} · Claim`] = history.filter((h) => h.asset_id === a.id && h.type === "Claim" && h.opened_at?.startsWith(m)).length;
      if (sel.Monitor) row[`${a.old_code} · Mon`] = history.filter((h) => h.asset_id === a.id && h.type === "Monitor" && h.opened_at?.startsWith(m)).length;
    }
    return row;
  });

  // Avg MTBF across selected assets
  const mtbfVals = perAsset.map((p) => p.mtbf).filter((n) => n > 0);
  const avgMtbf = mtbfVals.length ? mtbfVals.reduce((s, n) => s + n, 0) / mtbfVals.length : 0;
  const avgPm = perAsset.map((p) => p.pmInterval).filter((n) => n > 0);
  const avgPmInterval = avgPm.length ? avgPm.reduce((s, n) => s + n, 0) / avgPm.length : 0;

  // Simulator: if PM frequency = X days, expected claim reduction ratio
  // baseline assumption: shorter PM interval reduces claim rate proportionally
  const baselinePm = avgPmInterval || 30;
  const reduction = baselinePm > 0 ? Math.max(0, Math.min(80, ((baselinePm - pmFreqDays) / baselinePm) * 60)) : 0;

  // Maintenance debt: if delayed N months, expected extra failures
  const expectedExtraFailures = avgMtbf > 0
    ? Math.round((debtMonths * 30 / avgMtbf) * Math.max(assets.length, 1))
    : 0;

  // Service-level estimate
  const avgResponse = (() => {
    const rt = history.filter((h) => h.type === "Claim").map((h) => Number(h.payload?.responseTime)).filter((n) => Number.isFinite(n));
    return rt.length ? rt.reduce((a, b) => a + b, 0) / rt.length : 0;
  })();
  const availability = avgMtbf > 0 && avgResponse > 0 ? Math.max(0, Math.min(100, 100 - (avgResponse / (avgMtbf * 24)) * 100)) : 0;

  return (
    <div className="space-y-6">
      {/* Select types + view */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(["PM", "Claim", "Monitor"] as const).map((t) => (
            <label
              key={t}
              className={cn(
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer text-sm",
                sel[t] ? "text-white" : "bg-background",
              )}
              style={sel[t] ? { background: TYPE_COLOR[t], borderColor: TYPE_COLOR[t] } : undefined}
            >
              <input type="checkbox" checked={sel[t]} onChange={(e) => onSel({ ...sel, [t]: e.target.checked })} className="size-3.5" />
              {t}
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

      {/* Per-asset metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {perAsset.map((p) => (
          <div key={p.asset.id} className="rounded-xl border p-4 bg-card">
            <div className="flex items-center gap-2 mb-3">
              <span className="size-3 rounded-full" style={{ background: colorByAsset.get(p.asset.id) }} />
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted">{p.asset.old_code}</span>
              <span className="text-sm font-medium truncate">{p.asset.name ?? "—"}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center text-xs">
              <div><div className="text-2xl font-bold tabular-nums">{p.mtbf.toFixed(0)}</div><div className="text-muted-foreground">MTBF (วัน)</div></div>
              <div><div className="text-2xl font-bold tabular-nums">{p.pmInterval.toFixed(0)}</div><div className="text-muted-foreground">PM ทุก (วัน)</div></div>
              <div><div className="text-2xl font-bold tabular-nums">{p.monInterval.toFixed(0)}</div><div className="text-muted-foreground">ตรวจทุก (วัน)</div></div>
            </div>
            <div className="mt-3 flex gap-3 text-xs text-muted-foreground border-t pt-2">
              <span>PM {p.counts.PM}</span><span>Claim {p.counts.Claim}</span><span>Monitor {p.counts.Monitor}</span>
            </div>
          </div>
        ))}
      </div>

      {/* View */}
      {view === "graph" && (
        <div className="rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium">Trend Overlay — PM / Claim / Monitor</div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {(["PM", "Claim", "Monitor"] as const).map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-4 h-0.5" style={{ background: TYPE_COLOR[t] }} />
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0 0)" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <RTooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {assets.flatMap((a, idx) => {
                  const out: React.ReactNode[] = [];
                  const dash = ASSET_DASH[idx % ASSET_DASH.length];
                  if (sel.PM) out.push(<Line key={`${a.id}-pm`} type="monotone" dataKey={`${a.old_code} · PM`} stroke={TYPE_COLOR.PM} strokeWidth={2} dot strokeDasharray={dash} />);
                  if (sel.Claim) out.push(<Line key={`${a.id}-cl`} type="monotone" dataKey={`${a.old_code} · Claim`} stroke={TYPE_COLOR.Claim} strokeWidth={2} dot strokeDasharray={dash} />);
                  if (sel.Monitor) out.push(<Line key={`${a.id}-mn`} type="monotone" dataKey={`${a.old_code} · Mon`} stroke={TYPE_COLOR.Monitor} strokeWidth={2} dot strokeDasharray={dash} />);
                  return out;
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            สี = ประเภทงาน (PM/Claim/Monitor) — รูปแบบเส้น (ทึบ/ประ) = แต่ละป้าย
          </p>
        </div>
      )}

      {view === "table" && (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr><th className="text-left px-4 py-2.5">ป้าย</th><th className="text-left px-4 py-2.5">ประเภท</th><th className="text-left px-4 py-2.5">วันที่</th><th className="text-left px-4 py-2.5">สถานะ</th></tr>
            </thead>
            <tbody className="divide-y">
              {history.filter((h) => sel[h.type as keyof typeof sel]).slice(0, 50).map((h) => (
                <tr key={h.id}>
                  <td className="px-4 py-2 font-mono text-xs">{h.asset_old_code}</td>
                  <td className="px-4 py-2 text-xs"><Badge tone={h.type === "Claim" ? "danger" : h.type === "PM" ? "info" : "success"}>{h.type}</Badge></td>
                  <td className="px-4 py-2 text-xs">{fmtDate(h.opened_at)}</td>
                  <td className="px-4 py-2 text-xs">{h.status ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "calendar" && (
        <CalendarOverlay history={history.filter((h) => sel[h.type as keyof typeof sel])} colorByAsset={colorByAsset} />
      )}

      {/* Simulators */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border p-4 bg-card">
          <div className="flex items-center gap-2 mb-2"><Wrench className="size-4 text-primary" /><h4 className="font-semibold text-sm">PM Frequency Simulator</h4></div>
          <p className="text-xs text-muted-foreground mb-3">
            เลื่อนแถบเพื่อจำลองความถี่ PM ใหม่ (ปัจจุบันเฉลี่ย {baselinePm.toFixed(0)} วัน)
          </p>
          <input type="range" min={7} max={120} step={1} value={pmFreqDays} onChange={(e) => setPmFreqDays(Number(e.target.value))} className="w-full" />
          <div className="mt-1 text-xs text-muted-foreground">PM ทุก <strong className="text-foreground">{pmFreqDays}</strong> วัน</div>
          <div className="mt-3 rounded-lg bg-success/10 text-success p-2 text-sm">
            คาด Claim ลดลง <strong>{reduction.toFixed(0)}%</strong>
          </div>
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">วิธีคำนวณ</summary>
            <p className="mt-1">(baseline_pm − sim_pm) / baseline_pm × 60% โดย baseline คือ PM interval เฉลี่ยจากประวัติจริง — สูงสุด 80%</p>
          </details>
        </div>

        <div className="rounded-xl border p-4 bg-card">
          <div className="flex items-center gap-2 mb-2"><AlertCircle className="size-4 text-warning" /><h4 className="font-semibold text-sm">Maintenance Debt Simulator</h4></div>
          <p className="text-xs text-muted-foreground mb-3">หากเลื่อน PM ออกไป...</p>
          <input type="range" min={0} max={6} step={1} value={debtMonths} onChange={(e) => setDebtMonths(Number(e.target.value))} className="w-full" />
          <div className="mt-1 text-xs text-muted-foreground">เลื่อน <strong className="text-foreground">{debtMonths}</strong> เดือน</div>
          <div className="mt-3 rounded-lg bg-destructive/10 text-destructive p-2 text-sm">
            Risk of Failure คาดเพิ่ม <strong>{expectedExtraFailures}</strong> ครั้ง
          </div>
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">วิธีคำนวณ</summary>
            <p className="mt-1">(เดือนที่เลื่อน × 30) / MTBF × จำนวนป้าย — อิงสถิติ Claim จริง</p>
          </details>
        </div>

        <div className="rounded-xl border p-4 bg-card">
          <div className="flex items-center gap-2 mb-2"><Activity className="size-4 text-primary" /><h4 className="font-semibold text-sm">Service Level Simulator</h4></div>
          <p className="text-xs text-muted-foreground mb-3">
            Response Time เฉลี่ย {avgResponse.toFixed(1)} ชม. / MTBF {avgMtbf.toFixed(0)} วัน
          </p>
          <div className="mt-2 rounded-lg bg-primary/10 text-primary p-3 text-center">
            <div className="text-2xl font-bold">{availability.toFixed(1)}%</div>
            <div className="text-xs">System Availability</div>
          </div>
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">วิธีคำนวณ</summary>
            <p className="mt-1">100 − (avg_response_h / (MTBF_วัน × 24)) × 100</p>
          </details>
        </div>
      </div>
    </div>
  );
}

// Calendar — monthly view with prev/next navigation
function CalendarOverlay({ history, colorByAsset: _c }: { history: HistRow[]; colorByAsset: Map<string, string> }) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = cursor.toLocaleDateString("th-TH", { year: "numeric", month: "long" });
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthEvents = history.filter((h) => h.opened_at?.startsWith(monthKey));
  const todayKey = new Date().toISOString().slice(0, 10);

  const cells: { date: string | null; day: number | null; events: HistRow[] }[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ date: null, day: null, events: [] });
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ date: key, day: d, events: monthEvents.filter((h) => h.opened_at?.slice(0, 10) === key) });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null, events: [] });

  const typeColor = (t: string) =>
    t === "Claim" ? "oklch(0.6 0.22 25)" : t === "PM" ? "oklch(0.62 0.19 255)" : "oklch(0.65 0.16 155)";

  const dows = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium flex items-center gap-2">
          <CalIcon className="size-4" /> Maintenance Calendar
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCursor(new Date(year, month - 1, 1))}
            className="px-2.5 py-1 rounded-md border bg-background hover:bg-accent text-sm"
            aria-label="เดือนก่อนหน้า"
          >‹</button>
          <button
            onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
            className="px-3 py-1 rounded-md border bg-background hover:bg-accent text-xs"
          >วันนี้</button>
          <div className="min-w-[10rem] text-center text-sm font-medium tabular-nums">{monthLabel}</div>
          <button
            onClick={() => setCursor(new Date(year, month + 1, 1))}
            className="px-2.5 py-1 rounded-md border bg-background hover:bg-accent text-sm"
            aria-label="เดือนถัดไป"
          >›</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {dows.map((d) => (
          <div key={d} className="text-[11px] text-muted-foreground text-center py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c.date) return <div key={i} className="aspect-square rounded border border-dashed border-border/40 bg-muted/20" />;
          const isToday = c.date === todayKey;
          return (
            <div
              key={c.date}
              className={cn("aspect-square rounded border bg-background p-1.5 relative flex flex-col", isToday && "border-primary ring-1 ring-primary/30")}
              title={`${c.date} — ${c.events.length} รายการ`}
            >
              <div className={cn("text-[11px]", isToday ? "font-semibold text-primary" : "text-muted-foreground")}>{c.day}</div>
              {c.events.length > 0 && (
                <div className="mt-auto flex flex-wrap gap-0.5">
                  {c.events.slice(0, 6).map((e) => (
                    <span key={e.id} className="size-1.5 rounded-full" style={{ background: typeColor(e.type) }} />
                  ))}
                  {c.events.length > 6 && (
                    <span className="text-[9px] text-muted-foreground leading-none">+{c.events.length - 6}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[oklch(0.6_0.22_25)]" /> Claim</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[oklch(0.62_0.19_255)]" /> PM</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[oklch(0.65_0.16_155)]" /> Monitor</span>
        </div>
        <div className="text-xs text-muted-foreground">รวม {monthEvents.length} รายการในเดือนนี้</div>
      </div>
    </div>
  );
}
