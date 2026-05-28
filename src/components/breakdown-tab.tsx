import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer, BarChart, Bar, Cell,
} from "recharts";
import {
  AlertTriangle, Activity, Clock, Wrench, FileDown, ClipboardList,
  Zap, Monitor, Building, Cpu, RotateCcw, Info, Tag,
} from "lucide-react";
import { StatCard, Badge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { listDiagramMappings } from "@/lib/data.functions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HistRow = any;
type Asset = { id: string; old_code: string; name: string | null };

type MappingRow = {
  id: string; category: string; label: string; icon: string | null;
  keywords: string[]; sort_order: number; enabled: boolean;
};

const ICON_MAP: Record<string, typeof Zap> = {
  Monitor, Zap, Building, Cpu, Wrench, Activity, AlertTriangle, Clock, Tag,
};

const FALLBACK_MAPPINGS: MappingRow[] = [
  { id: "f1", category: "display",   label: "Display / Screen",      icon: "Monitor",  keywords: ["display","screen","จอ","led","pixel","panel","ภาพ"], sort_order: 1, enabled: true },
  { id: "f2", category: "power",     label: "Power / Electrical",    icon: "Zap",      keywords: ["power","ไฟฟ้า","การไฟฟ้า","electric","breaker","ไฟดับ","ไฟตก","voltage"], sort_order: 2, enabled: true },
  { id: "f3", category: "structure", label: "Structure",             icon: "Building", keywords: ["โครงสร้าง","structure","เสา","frame","ป้ายล้ม","โครง","bolt"], sort_order: 3, enabled: true },
  { id: "f4", category: "system",    label: "System / Media Player", icon: "Cpu",      keywords: ["media player","system","reset","software","ระบบ","firmware","reboot","network","signal"], sort_order: 4, enabled: true },
];

function classifyPart(h: HistRow, mappings: MappingRow[]): string {
  const text = [h.title, h.payload?.problemCategory, h.payload?.problemEquipment, h.payload?.problemDetail, h.payload?.solutionDetail]
    .filter(Boolean).join(" ").toLowerCase();
  for (const m of mappings) {
    if (!m.enabled) continue;
    if (m.keywords.some((k) => k && text.includes(k.toLowerCase()))) return m.category;
  }
  return "other";
}

/** ฟอร์แมตนาที → "X วัน Y ชม. Z นาที" (ข้อมูลดิบใน DB เก็บเป็น "นาที") */
function formatDuration(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "—";
  const total = Math.round(totalMinutes);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} วัน`);
  if (h) parts.push(`${h} ชม.`);
  if (m && d === 0) parts.push(`${m} นาที`);
  if (!parts.length) return `${total} นาที`;
  return parts.join(" ");
}

/** เลือกหน่วยแกน Y แบบ dynamic ตามค่า max (input: นาที) */
function pickTimeUnit(maxMinutes: number): { unit: "นาที" | "ชม." | "วัน"; divisor: number } {
  if (maxMinutes >= 1440 * 2) return { unit: "วัน", divisor: 1440 };
  if (maxMinutes >= 60) return { unit: "ชม.", divisor: 60 };
  return { unit: "นาที", divisor: 1 };
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function BreakdownTab({
  assets, history,
}: { assets: Asset[]; history: HistRow[] }) {
  // Only Claim type
  const claims = useMemo(
    () => history.filter((h) => h.type === "Claim" && h.opened_at),
    [history],
  );

  const [search, setSearch] = useState("");
  const [activePart, setActivePart] = useState<string | null>(null);

  // Load mappings from DB (admin-managed); fallback to defaults
  const fetchMappings = useServerFn(listDiagramMappings);
  const { data: mapData } = useQuery({
    queryKey: ["diagram-mappings"],
    queryFn: () => fetchMappings({}),
    staleTime: 60_000,
  });
  const mappings: MappingRow[] = useMemo(() => {
    const fromDb = (mapData?.mappings ?? []) as MappingRow[];
    return fromDb.length ? fromDb : FALLBACK_MAPPINGS;
  }, [mapData]);

  // Filter by asset search + part
  const filtered = useMemo(() => {
    return claims.filter((h) => {
      if (search && !String(h.asset_old_code ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      if (activePart && classifyPart(h, mappings) !== activePart) return false;
      return true;
    });
  }, [claims, search, activePart, mappings]);

  // ---- MTBF (overall on filtered set, per asset average) ----
  const mtbf = useMemo(() => {
    const byAsset = new Map<string, number[]>();
    for (const h of filtered) {
      const arr = byAsset.get(h.asset_id) ?? [];
      arr.push(new Date(h.opened_at).getTime());
      byAsset.set(h.asset_id, arr);
    }
    const intervals: number[] = [];
    byAsset.forEach((times) => {
      const s = [...times].sort((a, b) => a - b);
      for (let i = 1; i < s.length; i++) intervals.push((s[i] - s[i - 1]) / 86_400_000);
    });
    const avg = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
    return { days: avg, samples: intervals.length };
  }, [filtered]);

  // ---- Downtime (sum totalTurnaroundTime in MINUTES — DB stores minutes) ----
  const downtimeMin = useMemo(() => filtered.reduce((s, h) => {
    const n = Number(h.payload?.totalTurnaroundTime);
    return s + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0), [filtered]);

  // ---- Top problem categories ----
  const topCategories = useMemo(() => {
    const c = new Map<string, number>();
    for (const h of filtered) {
      const k = String(h.payload?.problemCategory ?? "ไม่ระบุ").trim() || "ไม่ระบุ";
      c.set(k, (c.get(k) ?? 0) + 1);
    }
    return Array.from(c.entries()).map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count).slice(0, 6);
  }, [filtered]);

  // ---- Temporary fix detection: same solutionDetail on same asset within 30 days ----
  const tempFixAlerts = useMemo(() => {
    const groups = new Map<string, HistRow[]>();
    for (const h of filtered) {
      const sol = String(h.payload?.solutionDetail ?? "").trim();
      if (!sol) continue;
      const key = `${h.asset_old_code}|${sol}`;
      const arr = groups.get(key) ?? [];
      arr.push(h);
      groups.set(key, arr);
    }
    const alerts: { asset: string; solution: string; count: number; spanDays: number }[] = [];
    groups.forEach((arr, key) => {
      const sorted = [...arr].sort((a, b) => new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime());
      for (let i = 1; i < sorted.length; i++) {
        const diff = (new Date(sorted[i].opened_at).getTime() - new Date(sorted[i - 1].opened_at).getTime()) / 86_400_000;
        if (diff <= 30) {
          const [asset, solution] = key.split("|");
          alerts.push({ asset, solution, count: sorted.length, spanDays: Math.round(diff) });
          break;
        }
      }
    });
    return alerts.slice(0, 6);
  }, [filtered]);

  // ---- Health score: based on claim frequency + MTBF ----
  const health = useMemo(() => {
    const count = filtered.length;
    const m = mtbf.days;
    let score = 100;
    if (m && m < 14) score -= 50;
    else if (m && m < 30) score -= 25;
    if (count > 20) score -= 20;
    else if (count > 10) score -= 10;
    score = Math.max(0, Math.min(100, score));
    const tone: "success" | "warning" | "danger" = score >= 70 ? "success" : score >= 40 ? "warning" : "danger";
    const label = score >= 70 ? "Stable" : score >= 40 ? "Warning" : "Critical";
    return { score, tone, label };
  }, [filtered.length, mtbf.days]);

  const critical = mtbf.samples > 0 && mtbf.days < 14;

  // ---- Scatter timeline data ----
  const scatterData = useMemo(() => filtered.map((h) => ({
    x: new Date(h.opened_at).getTime(),
    y: Number(h.payload?.totalTurnaroundTime) || 0,
    asset: h.asset_old_code,
    solution: h.payload?.solutionDetail || "—",
    category: h.payload?.problemCategory || "—",
    ticket: h.ticket_code,
    raw: h,
  })), [filtered]);

  // ---- Next predicted PM date (clamped: never in the past) ----
  const nextPredictedRaw = useMemo(() => {
    if (!filtered.length || !mtbf.days) return null;
    const last = Math.max(...filtered.map((h) => new Date(h.opened_at).getTime()));
    return new Date(last + mtbf.days * 86_400_000);
  }, [filtered, mtbf.days]);

  const predictedInPast = !!nextPredictedRaw && nextPredictedRaw.getTime() < Date.now();

  const nextPredicted = useMemo(() => {
    if (!nextPredictedRaw) return null;
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return new Date(Math.max(nextPredictedRaw.getTime(), tomorrow.getTime()));
  }, [nextPredictedRaw]);

  // ---- PM Work Order draft dialog ----
  const [pmOpen, setPmOpen] = useState(false);
  const [pmDate, setPmDate] = useState("");
  const [pmAsset, setPmAsset] = useState("");
  const [pmNote, setPmNote] = useState("");

  function openPMDialog() {
    const target = assets[0]?.old_code ?? filtered[0]?.asset_old_code ?? "";
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const defaultDate = nextPredicted && nextPredicted.getTime() >= tomorrow.getTime()
      ? nextPredicted
      : tomorrow;
    setPmAsset(target);
    setPmDate(defaultDate.toISOString().slice(0, 10));
    setPmNote(`อ้างอิงปัญหาหลัก: ${topCategories[0]?.name ?? "—"} | MTBF: ${mtbf.days.toFixed(1)} วัน`);
    setPmOpen(true);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const pmDateInvalid = !pmDate || pmDate <= todayStr;

  function confirmGeneratePM() {
    if (pmDateInvalid) {
      toast.error("วันนัดตรวจต้องเป็นวันที่อนาคต (หลังวันนี้)");
      return;
    }
    toast.success("บันทึกใบสั่งงาน PM (ฉบับร่าง) แล้ว", {
      description: `Asset: ${pmAsset || "—"} | นัดตรวจ: ${new Date(pmDate).toLocaleDateString("th-TH")}`,
    });
    setPmOpen(false);
  }

  function handleExport() {
    const rows = filtered.map((h) => ({
      ticket: h.ticket_code,
      asset: h.asset_old_code,
      opened_at: h.opened_at,
      closed_at: h.closed_at,
      problemCategory: h.payload?.problemCategory ?? "",
      problemEquipment: h.payload?.problemEquipment ?? "",
      solutionDetail: h.payload?.solutionDetail ?? "",
      responseTime_min: h.payload?.responseTime ?? "",
      responseTime_human: formatDuration(Number(h.payload?.responseTime)),
      resolveTime_min: h.payload?.resolveTime ?? "",
      resolveTime_human: formatDuration(Number(h.payload?.resolveTime)),
      totalTurnaroundTime_min: h.payload?.totalTurnaroundTime ?? "",
      totalTurnaroundTime_human: formatDuration(Number(h.payload?.totalTurnaroundTime)),
      status: h.status ?? "",
    }));
    downloadCsv(`breakdown-insight-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success("Export Insight Report สำเร็จ", { description: `${rows.length} รายการ` });
  }

  // Component counts for diagram badges (dynamic, keyed by category)
  const partCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const mp of mappings) m[mp.category] = 0;
    m.other = 0;
    for (const h of claims) {
      const k = classifyPart(h, mappings);
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }, [claims, mappings]);

  if (claims.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        ไม่มีประวัติ Claim สำหรับช่วงเวลา / ป้ายที่เลือก
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header filters */}
      <div className="rounded-xl border bg-card p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="text-xs text-muted-foreground">ค้นหา Asset Old Code</label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="พิมพ์รหัสป้ายเพื่อกรอง..." className="mt-1" />
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={health.tone}>Health: {health.label} ({health.score})</Badge>
          {critical && <Badge tone="danger">Critical Maintenance Needed</Badge>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Claim ที่กรองอยู่" value={filtered.length} icon={<AlertTriangle className="size-5" />} tone={filtered.length > 10 ? "warning" : "default"} />
        <StatCard label="MTBF (เฉลี่ย)" value={mtbf.days ? `${mtbf.days.toFixed(1)} วัน` : "—"} delta={`${mtbf.samples} ช่วงเวลา`} tone={critical ? "danger" : mtbf.days < 30 ? "warning" : "success"} icon={<Activity className="size-5" />} />
        <StatCard label="Downtime รวม" value={formatDuration(downtimeMin)} delta={`${filtered.length} tickets`} icon={<Clock className="size-5" />} tone="warning" />
        <StatCard label="นัดตรวจครั้งถัดไป" value={nextPredicted ? nextPredicted.toLocaleDateString("th-TH", { day: "2-digit", month: "short" }) : "—"} delta={predictedInPast ? "เลื่อนมาเป็นพรุ่งนี้ (ของเดิมเลยกำหนด)" : "คาดการณ์จาก MTBF"} icon={<Wrench className="size-5" />} tone={predictedInPast ? "warning" : "default"} />
      </div>

      {/* Interactive asset diagram */}
      <div className="rounded-xl border p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <div className="text-sm font-semibold">Interactive Asset Diagram</div>
            <div className="text-xs text-muted-foreground">คลิกที่ส่วนประกอบเพื่อกรองปัญหาเฉพาะจุด</div>
          </div>
          {activePart && (
            <Button size="sm" variant="outline" onClick={() => setActivePart(null)}>
              <RotateCcw className="size-3.5 mr-1" /> ล้างตัวกรอง
            </Button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(PART_META) as PartId[]).map((id) => {
            const meta = PART_META[id];
            const Icon = meta.icon;
            const isActive = activePart === id;
            const count = partCounts[id];
            return (
              <button
                key={id}
                onClick={() => setActivePart(isActive ? null : id)}
                className={cn(
                  "group rounded-lg border-2 p-4 text-left transition-all",
                  isActive
                    ? "border-primary bg-primary/5 shadow-[var(--shadow-elegant)]"
                    : "border-border hover:border-primary/50 bg-card",
                )}
              >
                <div className="flex items-start justify-between">
                  <div className={cn(
                    "size-10 rounded-lg grid place-items-center",
                    isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
                  )}>
                    <Icon className="size-5" />
                  </div>
                  <span className={cn(
                    "text-xs font-bold px-2 py-0.5 rounded-full",
                    count > 5 ? "bg-destructive/15 text-destructive" : count > 0 ? "bg-warning/15 text-[oklch(0.45_0.15_75)]" : "bg-muted text-muted-foreground",
                  )}>{count}</span>
                </div>
                <div className="mt-3 text-sm font-medium">{meta.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {isActive ? "กำลังกรองอยู่" : "คลิกเพื่อเจาะลึก"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recurring problems */}
        <div className="rounded-xl border p-5">
          <div className="text-sm font-semibold mb-1">Top Recurring Problems</div>
          <div className="text-xs text-muted-foreground mb-4">
            {topCategories[0] && `ป้ายล้มเหลวบ่อยจาก: ${topCategories[0].name}`}
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCategories} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0 0)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
                <RTooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {topCategories.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? "oklch(0.6 0.22 25)" : i < 3 ? "oklch(0.7 0.18 50)" : "oklch(0.65 0.16 155)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Temporary fix alerts */}
        <div className="rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="size-4 text-[oklch(0.45_0.15_75)]" />
            <div className="text-sm font-semibold">Temporary Fix Alerts</div>
          </div>
          <div className="text-xs text-muted-foreground mb-3">
            ใช้วิธีซ่อมเดิมซ้ำภายใน 30 วัน — แนะนำเปลี่ยนอะไหล่/อัปเกรดถาวร
          </div>
          {tempFixAlerts.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">ยังไม่พบรูปแบบการซ่อมซ้ำผิดปกติ</div>
          ) : (
            <ul className="space-y-2 max-h-56 overflow-auto pr-1">
              {tempFixAlerts.map((a, i) => (
                <li key={i} className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{a.asset}</span>
                    <Badge tone="warning">ซ่อมซ้ำ x{a.count}</Badge>
                  </div>
                  <div className="text-xs mt-1 text-foreground">{a.solution}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">ห่างกันเพียง {a.spanDays} วัน → ควรเปลี่ยนอะไหล่ถาวร</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Timeline scatter */}
      {(() => {
        const maxY = scatterData.reduce((m, d) => Math.max(m, d.y), 0);
        const yUnit = pickTimeUnit(maxY);
        return (
      <div className="rounded-xl border p-5">
        <div className="text-sm font-semibold mb-1">Timeline of Claim Tickets</div>
        <div className="text-xs text-muted-foreground mb-3">แต่ละจุด = 1 ticket — แกน Y คือ Turnaround Time ({yUnit.unit}). คลิกเพื่อดูรายละเอียด</div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0 0)" />
              <XAxis
                dataKey="x" type="number" domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => new Date(v).toLocaleDateString("th-TH", { month: "short", day: "2-digit" })}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                dataKey="y" type="number" name={`Turnaround (${yUnit.unit})`} tick={{ fontSize: 11 }}
                tickFormatter={(v) => (v / yUnit.divisor).toFixed(v / yUnit.divisor >= 10 ? 0 : 1)}
                label={{ value: yUnit.unit, angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "oklch(0.5 0 0)" } }}
              />
              <ZAxis range={[60, 60]} />
              <RTooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as typeof scatterData[number];
                  return (
                    <div className="rounded-md border bg-background p-2 text-xs shadow-md max-w-xs">
                      <div className="font-mono font-semibold">{p.asset}</div>
                      <div className="text-muted-foreground">{new Date(p.x).toLocaleString("th-TH")}</div>
                      <div className="mt-1"><span className="text-muted-foreground">ปัญหา:</span> {p.category}</div>
                      <div><span className="text-muted-foreground">วิธีแก้:</span> {p.solution}</div>
                      <div><span className="text-muted-foreground">Turnaround:</span> {formatDuration(p.y)}</div>
                    </div>
                  );
                }}
              />
              <Scatter
                data={scatterData}
                fill="oklch(0.6 0.22 25)"
                onClick={(d) => {
                  const p = d as unknown as typeof scatterData[number];
                  toast.info(`Ticket ${p.ticket ?? ""}`, {
                    description: `${p.asset} — ${p.category}\n${p.solution}\nTurnaround: ${formatDuration(p.y)}`,
                  });
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
        );
      })()}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 justify-end">
        <Button variant="outline" onClick={handleExport}>
          <FileDown className="size-4 mr-1" /> Export Insight Report
        </Button>
        <Button onClick={openPMDialog}>
          <ClipboardList className="size-4 mr-1" /> Generate PM Work Order
        </Button>
      </div>

      {/* PM Work Order Dialog */}
      <Dialog open={pmOpen} onOpenChange={setPmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>สร้างใบสั่งงาน PM (ฉบับร่าง)</DialogTitle>
            <DialogDescription>
              ตรวจสอบและแก้ไขรายละเอียดก่อนยืนยัน — วันนัดต้องเป็นวันที่อนาคต
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Asset Old Code</label>
              <Input value={pmAsset} onChange={(e) => setPmAsset(e.target.value)} className="mt-1 font-mono" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">วันนัดตรวจ</label>
              <Input
                type="date"
                value={pmDate}
                min={(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })()}
                onChange={(e) => setPmDate(e.target.value)}
                className="mt-1"
              />
              {pmDateInvalid && (
                <div className="mt-1 text-xs text-destructive">วันนัดต้องหลังวันนี้ ({new Date().toLocaleDateString("th-TH")})</div>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">หมายเหตุ</label>
              <Input value={pmNote} onChange={(e) => setPmNote(e.target.value)} className="mt-1" />
            </div>
            <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground flex gap-2">
              <Info className="size-3.5 mt-0.5 shrink-0" />
              <span>ปัจจุบันใบสั่งงานจะถูกบันทึกเป็น "ฉบับร่าง" และยังไม่ผูกกับเมนูแผนงาน PM (ยังไม่มีตารางจัดเก็บถาวรในระบบ) — หากต้องการให้บันทึกถาวรและเชื่อมไปยังเมนู PM โปรดแจ้งเพื่อสร้างตาราง pm_work_orders ให้</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPmOpen(false)}>ยกเลิก</Button>
            <Button onClick={confirmGeneratePM} disabled={pmDateInvalid}>ยืนยันสร้าง</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
