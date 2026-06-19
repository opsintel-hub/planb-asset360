import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { memo, useMemo, useState } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Activity,
  AlertTriangle,
  AlertCircle,
  Building2,
  CalendarClock,
  Download,
  Info,
  RefreshCw,
  Search as SearchIcon,
  X,
} from "lucide-react";
import { getMonitoringData, getMonitoringFilterOptions } from "@/lib/monitoring.functions";

export const Route = createFileRoute("/monitoring")({
  head: () => ({
    meta: [
      { title: "Monitoring — สุขภาพป้ายและการตรวจ PM" },
      { name: "description", content: "ติดตามสถานะการตรวจ PM และอาการเสียที่เกิดหลังตรวจของป้ายทุกแผนก" },
    ],
  }),
  component: MonitoringPage,
});

const PIE_COLORS = [
  "oklch(0.7 0.14 160)",
  "oklch(0.72 0.17 60)",
  "oklch(0.68 0.18 25)",
  "oklch(0.66 0.18 250)",
  "oklch(0.7 0.18 320)",
  "oklch(0.75 0.14 100)",
];

type AppliedFilters = {
  oldCode: string;
  zones: string[];
  projects: string[];
  mediaTypes: string[];
  fromDate: string;
  toDate: string;
};

const MultiSelect = memo(function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary =
    value.length === 0
      ? "ทั้งหมด"
      : value.length <= 2
        ? value.join(", ")
        : `${value.slice(0, 2).join(", ")} +${value.length - 2}`;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full inline-flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent"
      >
        <span className="truncate text-left">
          <span className="text-muted-foreground">{label}:</span> <span className="font-medium">{summary}</span>
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-72 w-72 overflow-auto rounded-md border bg-popover p-2 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between px-1 pb-2 text-xs">
              <button className="text-primary" onClick={() => onChange(options)}>เลือกทั้งหมด</button>
              <button className="text-muted-foreground" onClick={() => onChange([])}>ล้าง</button>
            </div>
            {options.map((o) => {
              const checked = value.includes(o);
              return (
                <label key={o} className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer">
                  <input type="checkbox" checked={checked} onChange={() => onChange(checked ? value.filter((v) => v !== o) : [...value, o])} />
                  <span className="truncate">{o}</span>
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
});

const AssetCodeCombobox = memo(function AssetCodeCombobox({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const q = value.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!options.length) return [] as string[];
    if (!q) return options.slice(0, 20);
    const starts: string[] = [];
    const contains: string[] = [];
    for (const o of options) {
      const lo = o.toLowerCase();
      if (lo.startsWith(q)) starts.push(o);
      else if (lo.includes(q)) contains.push(o);
      if (starts.length + contains.length >= 40) break;
    }
    return [...starts, ...contains].slice(0, 20);
  }, [q, options]);

  const showPanel = (focused || open) && suggestions.length > 0;

  return (
    <Popover open={showPanel} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <SearchIcon className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="พิมพ์รหัสป้ายเพื่อค้นหา..."
            value={value}
            onChange={(e) => { onChange(e.target.value); setOpen(true); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            className="pl-8 pr-7"
          />
          {value && (
            <button
              type="button"
              aria-label="ล้างคำค้น"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => onChange("")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[--radix-popover-trigger-width] p-1 max-h-60 overflow-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {suggestions.map((c) => (
          <button
            key={c}
            type="button"
            className="w-full text-left px-2 py-1 text-xs rounded hover:bg-accent font-mono"
            onMouseDown={(e) => { e.preventDefault(); onChange(c); setOpen(false); setFocused(false); }}
          >
            {c}
          </button>
        ))}
        {options.length === 0 && (
          <div className="px-2 py-2 text-xs text-muted-foreground">ไม่มีรหัสป้ายที่ตรงกับตัวกรอง</div>
        )}
      </PopoverContent>
    </Popover>
  );
});

function MonitoringPage() {
  const fn = useServerFn(getMonitoringData);
  const optsFn = useServerFn(getMonitoringFilterOptions);
  const qc = useQueryClient();
  const today = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  // Helpers: month string "YYYY-MM" ↔ day boundaries (TZ-safe, plain string)
  const monthFirstDay = (ym: string) => `${ym}-01`;
  const monthLastDay = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    // Day 0 of next month = last day of current month
    const d = new Date(Date.UTC(y, m, 0));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  };
  const currentMonth = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`;
  // Default = Jan 2026 → current month
  const defaultFromMonth = "2026-01";

  const [oldCode, setOldCode] = useState("");
  const [zones, setZones] = useState<string[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [mediaTypes, setMediaTypes] = useState<string[]>([]);
  const [fromMonth, setFromMonth] = useState(defaultFromMonth);
  const [toMonth, setToMonth] = useState(currentMonth);

  const [applied, setApplied] = useState<AppliedFilters | null>(null);

  const { data: optsData } = useQuery({
    queryKey: ["monitoring-filter-options"],
    queryFn: () => optsFn(),
    staleTime: 30 * 60_000,
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["monitoring", applied],
    queryFn: () =>
      fn({
        data: {
          oldCode: applied!.oldCode,
          zones: applied!.zones,
          projects: applied!.projects,
          mediaTypes: applied!.mediaTypes,
          fromDate: applied!.fromDate,
          toDate: applied!.toDate,
        },
      }),
    enabled: applied !== null,
    staleTime: 5 * 60_000,
  });

  const filterOptionsRaw = optsData ?? data?.filters ?? { departments: [], zones: [], projects: [], mediaTypes: [] };
  const assetMeta = (optsData as { assetMeta?: Array<{ code: string; project: string | null; mediaType: string | null; zones: string[]; projects: string[] }> } | undefined)?.assetMeta ?? [];

  const matchesAsset = (
    a: { project: string | null; mediaType: string | null; zones: string[]; projects: string[] },
    skip: "projects" | "zones" | "mediaTypes" | null,
  ): boolean => {
    if (skip !== "projects" && projects.length) {
      const ok = projects.some((p) => a.project === p || a.projects.includes(p));
      if (!ok) return false;
    }
    if (skip !== "zones" && zones.length) {
      const ok = zones.some((z) => a.zones.includes(z));
      if (!ok) return false;
    }
    if (skip !== "mediaTypes" && mediaTypes.length) {
      const ok = mediaTypes.some((m) => a.mediaType === m);
      if (!ok) return false;
    }
    return true;
  };

  const availableProjects = useMemo(() => {
    if (!assetMeta.length) return filterOptionsRaw.projects;
    const s = new Set<string>();
    for (const a of assetMeta) {
      if (!matchesAsset(a, "projects")) continue;
      if (a.project) s.add(a.project);
      for (const p of a.projects) s.add(p);
    }
    return Array.from(s).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMeta, zones, mediaTypes]);

  const availableZones = useMemo(() => {
    if (!assetMeta.length) return filterOptionsRaw.zones;
    const s = new Set<string>();
    for (const a of assetMeta) {
      if (!matchesAsset(a, "zones")) continue;
      for (const z of a.zones) s.add(z);
    }
    return Array.from(s).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMeta, projects, mediaTypes]);

  const availableMediaTypes = useMemo(() => {
    if (!assetMeta.length) return filterOptionsRaw.mediaTypes;
    const s = new Set<string>();
    for (const a of assetMeta) {
      if (!matchesAsset(a, "mediaTypes")) continue;
      if (a.mediaType) s.add(a.mediaType);
    }
    return Array.from(s).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMeta, projects, zones]);

  const assetCodeOptions = useMemo(() => {
    if (!assetMeta.length) return [] as string[];
    const out: string[] = [];
    for (const a of assetMeta) if (matchesAsset(a, null)) out.push(a.code);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMeta, projects, zones, mediaTypes]);

  const filterOptions = {
    departments: filterOptionsRaw.departments,
    projects: availableProjects,
    zones: availableZones,
    mediaTypes: availableMediaTypes,
  };

  const handleApply = () => {
    setApplied({
      oldCode,
      zones,
      projects,
      mediaTypes,
      fromDate: monthFirstDay(fromMonth),
      toDate: monthLastDay(toMonth),
    });
  };
  const handleReset = () => {
    setOldCode(""); setZones([]); setProjects([]); setMediaTypes([]);
    setFromMonth(defaultFromMonth); setToMonth(currentMonth);
    setApplied(null);
  };



  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="size-6 text-primary" /> Monitoring
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            ติดตามสถานะการตรวจ PM และอาการเสียที่เกิดหลังตรวจของป้ายทุกแผนก
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: ["monitoring"] })}
          disabled={isFetching || applied === null}
        >
          <RefreshCw className={"size-4 " + (isFetching ? "animate-spin" : "")} />
          รีเฟรช
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">
                กลุ่มสื่อ (Project)
              </label>
              <MultiSelect label="กลุ่มสื่อ" options={filterOptions.projects} value={projects} onChange={setProjects} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">พื้นที่ (BKK/UPC)</label>
              <MultiSelect label="พื้นที่" options={filterOptions.zones} value={zones} onChange={setZones} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Media Type</label>
              <MultiSelect label="Media Type" options={filterOptions.mediaTypes} value={mediaTypes} onChange={setMediaTypes} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                ค้นหารหัสป้าย (Old Code)
                {assetCodeOptions.length > 0 && (
                  <span className="ml-1 text-[10px]">({assetCodeOptions.length.toLocaleString()} รายการ)</span>
                )}
              </label>
              <AssetCodeCombobox value={oldCode} onChange={setOldCode} options={assetCodeOptions} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">เดือนเริ่ม</label>
              <Input type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} max={toMonth} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">ถึงเดือน</label>
              <Input type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value)} min={fromMonth} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
            <p className="text-xs text-muted-foreground">
              {applied === null
                ? "ตั้งค่าตัวกรองแล้วกด “แสดงข้อมูล” เพื่อโหลด"
                : "ตัวกรองปัจจุบันมีผลกับทุก Tab"}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleReset} disabled={isFetching}>ล้างค่า</Button>
              <Button size="sm" onClick={handleApply} disabled={isFetching}>
                {isFetching ? <><RefreshCw className="size-4 animate-spin" />กำลังโหลด...</> : applied === null ? "แสดงข้อมูล" : "อัปเดตข้อมูล"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {applied === null ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground space-y-2">
            <Activity className="size-10 mx-auto opacity-40" />
            <p className="text-sm">ยังไม่มีข้อมูลแสดง</p>
            <p className="text-xs">ตั้งค่าตัวกรองแล้วกด “แสดงข้อมูล”</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : data ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={Building2}
              label="ป้ายทั้งหมด"
              value={data.kpi.totalAssets}
              color="text-blue-500"
              info="ที่มา: ตาราง assets (นับเฉพาะป้ายที่ payload.IsDeleted ≠ true) หลังกรองด้วย Old Code/Project/พื้นที่/Media Type"
            />
            <KpiCard
              icon={AlertCircle}
              label="12 เดือนย้อนหลังยังไม่เคยตรวจ"
              value={data.kpi.neverPm}
              color="text-orange-500"
              info="ที่มา: mssql_asset_history (category=Monitoring) ของป้ายที่อยู่ในขอบเขต — นับป้ายที่ไม่มีการตรวจสถานะ Pass เลยภายใน 365 วันล่าสุด"
            />
            <KpiCard
              icon={AlertTriangle}
              label="ตรวจแล้วเสียภายใน 7 วัน"
              value={data.kpi.earlyFail7}
              color="text-rose-500"
              info="ที่มา: คู่ Monitor.closed_at → Claim.opened_at ของ Old Code เดียวกัน (ช่วง 0–7 วัน) เฉพาะที่ Monitor ปิดอยู่ในช่วงเดือนที่เลือก"
            />
            <KpiCard
              icon={CalendarClock}
              label="ตั๋วเปิดแล้วรอตรวจ (Pending)"
              value={data.kpi.pendingTickets}
              color="text-amber-500"
              info="ที่มา: mssql_asset_history (category=Monitoring) — นับป้ายที่สถานะตรวจล่าสุด (payload.assetStatus) ยังไม่ใช่ Pass/Fail/Skip"
            />
          </div>



          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full sm:w-auto">
              <TabsTrigger value="overview">ภาพรวม</TabsTrigger>
              <TabsTrigger value="inspection">สถานะตรวจ</TabsTrigger>
              <TabsTrigger value="aging">ตรวจ→Claim</TabsTrigger>
              <TabsTrigger value="tickets">รายการป้าย</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <OverviewTab data={data} />
            </TabsContent>
            <TabsContent value="inspection">
              <InspectionTab rows={data.inspectionRows} />
            </TabsContent>
            <TabsContent value="aging">
              <AgingTab aging={data.aging} pairs={data.pairs} earlySymptoms={data.earlySymptoms} />
            </TabsContent>
            <TabsContent value="tickets">
              <TicketsTab rows={data.ticketRows} />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, color, info }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; color: string; info?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-muted-foreground truncate">{label}</p>
              {info && (
                <span title={info} className="text-muted-foreground/70 cursor-help">
                  <Info className="size-3.5" />
                </span>
              )}
            </div>
            <p className="text-2xl font-bold mt-1 tabular-nums">{value.toLocaleString()}</p>
          </div>
          <Icon className={`size-8 shrink-0 ${color}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function SectionTitle({ title, info }: { title: string; info: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      <span title={info} className="text-muted-foreground/70 cursor-help">
        <Info className="size-3.5" />
      </span>
    </div>
  );
}

function FormulaNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">{children}</p>;
}

type MonitoringData = NonNullable<ReturnType<typeof useQuery<Awaited<ReturnType<typeof getMonitoringData>>>>["data"]>;

function OverviewTab({ data }: { data: MonitoringData }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardContent className="pt-6">
          <SectionTitle
            title="สัดส่วนสถานะการตรวจ (ในช่วงที่เลือก)"
            info="ที่มา: mssql_asset_history (category=Monitoring) — นับทุก Monitor event ที่ opened_at อยู่ในช่วงเดือนที่เลือก จำแนกตาม payload.assetStatus"
          />
          <FormulaNote>
            สูตร: นับ Monitor event ทุกครั้งของป้ายในขอบเขต ที่ opened_at อยู่ระหว่างเดือนเริ่ม–ถึงเดือน → map payload.assetStatus เป็น Pending/Pass/Fail/Skip → รวมจำนวนเหตุการณ์ในแต่ละสถานะ (ไม่ใช่นับป้าย)
          </FormulaNote>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={data.statusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} label>
                {data.statusPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <SectionTitle
            title="จำนวนการตรวจตามสถานะ แยกรายแผนก"
            info="ที่มา: รวมข้อมูลเดียวกับ Pie ด้านซ้าย — จัดกลุ่มตาม assets.department"
          />
          <FormulaNote>
            สูตร: group by assets.department แล้วนับ Monitor event ในช่วงเดือนที่เลือก จำแนกเป็น 4 สถานะ — แท่งเรียงตามจำนวนเหตุการณ์มาก→น้อย
          </FormulaNote>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.byDepartment} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="dept" width={140} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Pending" stackId="a" fill={PIE_COLORS[1]} name="ยังไม่ได้ตรวจ" />
              <Bar dataKey="Pass" stackId="a" fill={PIE_COLORS[0]} name="ตรวจผ่าน" />
              <Bar dataKey="Fail" stackId="a" fill={PIE_COLORS[2]} name="ตรวจไม่ผ่าน" />
              <Bar dataKey="Skip" stackId="a" fill={PIE_COLORS[3]} name="ยกเลิกการตรวจ" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardContent className="pt-6">
          <SectionTitle
            title="Top 10 อาการที่พบบ่อย (เสียภายใน 7 วันหลังตรวจ)"
            info="ที่มา: จับคู่ Monitor.closed_at กับ Claim.opened_at ใน mssql_asset_history (Old Code เดียวกัน) — เฉพาะคู่ที่ห่างกัน ≤ 7 วัน และ Monitor ปิดอยู่ในช่วงเดือนที่เลือก"
          />
          <FormulaNote>
            สูตร: สำหรับแต่ละ Monitor → หา Claim ถัดไปของป้ายเดียวกัน → ถ้า (Claim.opened_at − Monitor.closed_at) ระหว่าง 0–7 วัน → นับ payload.informDetail (หรือ problemDetail ถ้าว่าง). แสดง 10 อาการที่พบบ่อยที่สุด — ตัวเลขนี้ต้องสอดคล้องกับ KPI "ตรวจแล้วเสียภายใน 7 วัน"
          </FormulaNote>

          {data.topSymptoms.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">ไม่มีข้อมูล</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.topSymptoms} layout="vertical" margin={{ left: 30, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={220} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill={PIE_COLORS[0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InspectionTab({ rows }: { rows: MonitoringData["inspectionRows"] }) {
  const [filter, setFilter] = useState<"all" | "Pending" | "Pass" | "Fail" | "Skip">("all");
  const [q, setQ] = useState("");
  const counts = useMemo(() => {
    const c = { Pending: 0, Pass: 0, Fail: 0, Skip: 0 };
    for (const r of rows) c[r.lastStatus as keyof typeof c]++;
    return c;
  }, [rows]);
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter !== "all" && r.lastStatus !== filter) return false;
      if (q && !r.assetCode.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [rows, filter, q]);
  const BTN: { key: typeof filter; label: string }[] = [
    { key: "all", label: `ทั้งหมด (${rows.length})` },
    { key: "Pending", label: `ยังไม่ได้ตรวจ (${counts.Pending})` },
    { key: "Pass", label: `ตรวจผ่าน (${counts.Pass})` },
    { key: "Fail", label: `ตรวจไม่ผ่าน (${counts.Fail})` },
    { key: "Skip", label: `ยกเลิกการตรวจ (${counts.Skip})` },
  ];
  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div className="space-y-1">
          <SectionTitle
            title="สถานะการตรวจรายป้าย"
            info="ที่มา: assets (ป้ายในขอบเขต) + mssql_asset_history.category='Monitoring' — แต่ละแถวสรุปจำนวนครั้งที่ตรวจ, วันที่ตรวจล่าสุด, ค่าเฉลี่ยห่างระหว่างการตรวจ, และสถานะล่าสุด"
          />
          <FormulaNote>
            สูตร: pmCount = จำนวน Monitor ของป้าย · lastPmDate = opened_at ล่าสุด · daysSinceLastPm = วันนี้ − lastPmDate · avgIntervalDays = ค่าเฉลี่ยช่วงห่างระหว่างคู่ Monitor ที่อยู่ติดกัน · สถานะ = payload.assetStatus ของ Monitor ล่าสุด (ว่าง = Pending). จำนวนตามปุ่มกรองรวมกัน = จำนวนป้ายทั้งหมด
          </FormulaNote>
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {BTN.map((b) => (
              <Button key={b.key} size="sm" variant={filter === b.key ? "default" : "outline"} onClick={() => setFilter(b.key)}>
                {b.label}
              </Button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <SearchIcon className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="ค้นหา Old Code..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
        </div>

        <div className="overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Old Code</TableHead>
                <TableHead>แผนก</TableHead>
                <TableHead className="text-right">ตรวจไปแล้ว</TableHead>
                <TableHead>ตรวจครั้งล่าสุด</TableHead>
                <TableHead className="text-right">วันที่ผ่านมา</TableHead>
                <TableHead className="text-right">ค่าเฉลี่ยห่าง</TableHead>
                <TableHead>สถานะ(TICKET)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 500).map((r) => {
                const danger = r.pmCount === 0;
                const warn = r.daysSinceLastPm != null && r.daysSinceLastPm > 60;
                return (
                  <TableRow key={r.assetCode} className={danger ? "bg-rose-50 dark:bg-rose-950/30" : warn ? "bg-orange-50 dark:bg-orange-950/30" : ""}>
                    <TableCell className="font-mono text-xs">
                      <Link to="/search" search={{ q: r.assetCode } as never} className="hover:underline text-primary">{r.assetCode}</Link>
                    </TableCell>
                    <TableCell className="text-xs">{r.department || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.pmCount}</TableCell>
                    <TableCell className="text-xs">{r.lastPmDate || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.daysSinceLastPm ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.avgIntervalDays ?? "—"}</TableCell>
                    <TableCell>
                      {r.lastStatus === "Pass" ? <Badge tone="success">Pass</Badge>
                        : r.lastStatus === "Fail" ? <Badge tone="danger">Fail</Badge>
                        : r.lastStatus === "Skip" ? <Badge tone="default">Skip</Badge>
                        : <Badge tone="warning">Pending</Badge>}
                    </TableCell>

                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {filtered.length > 500 && <p className="text-xs text-muted-foreground">แสดง 500 รายการแรกจาก {filtered.length}</p>}
      </CardContent>
    </Card>
  );
}

function AgingTab({ aging, pairs, earlySymptoms }: { aging: MonitoringData["aging"]; pairs: MonitoringData["pairs"]; earlySymptoms: MonitoringData["earlySymptoms"] }) {
  const [bucket, setBucket] = useState<string | null>(null);
  const filtered = useMemo(() => {
    if (!bucket) return pairs.slice(0, 500);
    return pairs.filter((p) => {
      if (bucket === "0-3") return p.days >= 0 && p.days <= 3;
      if (bucket === "4-7") return p.days >= 4 && p.days <= 7;
      if (bucket === "8-15") return p.days >= 8 && p.days <= 15;
      if (bucket === "16-30") return p.days >= 16 && p.days <= 30;
      if (bucket === "31-60") return p.days >= 31 && p.days <= 60;
      if (bucket === "61-90") return p.days >= 61 && p.days <= 90;
      if (bucket === ">90") return p.days > 90;
      return true;
    }).slice(0, 500);
  }, [pairs, bucket]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <SectionTitle
              title="ตรวจเสร็จ → เปิด Claim (ช่วงเวลา)"
              info="ที่มา: คู่ Monitor.closed_at → Claim.opened_at ของ Old Code เดียวกัน (จาก mssql_asset_history) เฉพาะที่ Monitor ปิดอยู่ในช่วงเดือนที่เลือก"
            />
            <FormulaNote>
              สูตร: gap = floor((Claim.opened_at − Monitor.closed_at)/24h) แล้วจัดกลุ่มเป็น 0–3, 4–7, 8–15, 16–30, 31–60, 61–90, &gt;90 วัน. ผลรวมของ 0–3 + 4–7 ต้องเท่ากับ KPI "ตรวจแล้วเสียภายใน 7 วัน"
            </FormulaNote>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={aging}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="bucket" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill={PIE_COLORS[3]} onClick={(d) => setBucket(d.bucket === bucket ? null : d.bucket)} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground mt-2">คลิกแท่งเพื่อกรองตารางด้านล่าง · {bucket && <button className="text-primary hover:underline" onClick={() => setBucket(null)}>ล้างตัวกรอง ({bucket})</button>}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <SectionTitle
              title="อาการที่เกิดเร็ว (ภายใน 7 วันหลังตรวจ)"
              info="ที่มา: payload.informDetail (หรือ problemDetail) ของ Claim ที่เปิดภายใน 7 วันหลัง Monitor ปิด — กลุ่มเดียวกับ Top 10 ในแท็บภาพรวม"
            />
            <FormulaNote>
              สูตร: filter คู่ที่ gap ≤ 7 วัน → group by อาการ → แสดงเป็นสัดส่วน
            </FormulaNote>
            {earlySymptoms.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">ไม่มี — ไม่มีป้ายที่เสียภายใน 7 วันหลังตรวจ</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={earlySymptoms} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(d) => d.name.slice(0, 14)}>
                    {earlySymptoms.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
            <p className="text-xs text-muted-foreground mt-2">→ ใช้เป็น checklist สำหรับการตรวจรอบหน้า</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <SectionTitle
            title={`รายละเอียดคู่ ตรวจ→Claim${bucket ? ` (กรอง: ${bucket} วัน)` : ""}`}
            info="ที่มา: คู่ Monitor → Claim ที่ใช้สร้างกราฟด้านบน — เรียงตามวันที่ตรวจ"
          />

          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Old Code</TableHead>
                  <TableHead>แผนก</TableHead>
                  <TableHead>วันที่ตรวจ</TableHead>
                  <TableHead>วันที่ Claim</TableHead>
                  <TableHead className="text-right">ห่าง (วัน)</TableHead>
                  <TableHead>สถานะ(TICKET)</TableHead>
                  <TableHead className="text-right">ระยะเวลาแก้ปัญหาและตรวจสอบ(TICKET)</TableHead>
                  <TableHead>ASSET STATUS</TableHead>
                  <TableHead>อาการ (informDetail)</TableHead>
                  <TableHead>Ticket</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p, i) => (
                  <TableRow key={i} className={p.days <= 7 ? "bg-rose-50 dark:bg-rose-950/30" : ""}>
                    <TableCell className="font-mono text-xs">
                      <Link to="/search" search={{ q: p.assetCode } as never} className="hover:underline text-primary">{p.assetCode}</Link>
                    </TableCell>
                    <TableCell className="text-xs">{p.department || "—"}</TableCell>
                    <TableCell className="text-xs">{p.pmDate}</TableCell>
                    <TableCell className="text-xs">{p.claimDate}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.days <= 7 ? <Badge tone="danger">{p.days}</Badge> : p.days}
                    </TableCell>
                    <TableCell className="text-xs">{(p as any).status}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{Math.round((p as any).days * 24)} ชม.</TableCell>
                    <TableCell className="text-xs">{(p as any).assetStatus}</TableCell>
                    <TableCell className="text-xs max-w-xs truncate" title={p.informDetail}>{p.informDetail}</TableCell>
                    <TableCell className="text-xs font-mono">{p.claimRef}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {pairs.length > 500 && !bucket && <p className="text-xs text-muted-foreground mt-2">แสดง 500 รายการแรกจาก {pairs.length}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function TicketsTab({ rows }: { rows: MonitoringData["ticketRows"] }) {
  const [q, setQ] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (onlyOpen && (r.status === "Finished" || r.status === "Closed" || r.status === "Approved")) return false;
      if (q) {
        const s = q.toLowerCase();
        if (!r.assetCode.toLowerCase().includes(s) && !r.refNumber.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [rows, q, onlyOpen]);

  const exportCsv = () => {
    const headers = ["Old Code", "แผนก", "Ticket", "Created", "Updated", "Closed", "Status", "Pending", "Last Inspection"];
    const lines = [headers.join(",")];
    for (const r of filtered) {
      lines.push([r.assetCode, r.department, r.refNumber, r.createdDate, r.updatedDate, r.closedDate, r.status, r.pending ? "Yes" : "No", r.lastInspectStatus].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `monitoring-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div className="space-y-1">
          <SectionTitle
            title="รายการตั๋ว Claim ในช่วง"
            info="ที่มา: claim_tickets ที่เปิดอยู่ในช่วงเดือนที่เลือก (payload.createdDate หรือ opened_at)"
          />
          <FormulaNote>
            สูตร: Created = payload.createdDate · Updated = payload.updatedDate · Closed = Updated เมื่อ status ∈ Finished/Closed/Approved · Pending = ตั๋วที่ Created = Updated (ยังไม่ขยับ) · การตรวจล่าสุด = สถานะ Monitor ล่าสุดของป้ายเดียวกัน
          </FormulaNote>
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-72">
              <SearchIcon className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="ค้นหา Old Code / Ticket..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
            </div>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
              เฉพาะที่ยังไม่ปิด
            </label>
          </div>
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="size-4" /> Export CSV
          </Button>
        </div>
        <div className="overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Old Code</TableHead>
                <TableHead>แผนก</TableHead>
                <TableHead>Ticket</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Closed</TableHead>
                <TableHead>สถานะ(TICKET)</TableHead>
                <TableHead>การตรวจล่าสุด</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 500).map((r) => (
                <TableRow key={r.refNumber} className={r.pending ? "bg-amber-50 dark:bg-amber-950/30" : ""}>
                  <TableCell className="font-mono text-xs">
                    <Link to="/search" search={{ q: r.assetCode } as never} className="hover:underline text-primary">{r.assetCode}</Link>
                  </TableCell>
                  <TableCell className="text-xs">{r.department || "—"}</TableCell>
                  <TableCell className="text-xs font-mono">{r.refNumber}</TableCell>
                  <TableCell className="text-xs">{r.createdDate || "—"}</TableCell>
                  <TableCell className="text-xs">{r.updatedDate || "—"}</TableCell>
                  <TableCell className="text-xs">{r.closedDate || "—"}</TableCell>
                  <TableCell>
                    <Badge tone={r.status === "Finished" || r.status === "Closed" || r.status === "Approved" ? "success" : r.status === "Working On" ? "default" : "warning"}>
                      {r.status || "—"}
                    </Badge>
                    {r.pending && <span className="ml-1"><Badge tone="warning">Pending</Badge></span>}
                  </TableCell>
                  <TableCell className="text-xs">{r.lastInspectStatus}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {filtered.length > 500 && <p className="text-xs text-muted-foreground">แสดง 500 รายการแรกจาก {filtered.length}</p>}
      </CardContent>
    </Card>
  );
}
