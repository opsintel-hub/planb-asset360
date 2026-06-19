import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { memo, useMemo, useState } from "react";
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
  LineChart,
  Line,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  CheckCircle2,
  AlertCircle,
  PackageOpen,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import {
  getMonitoringInsights,
  getMonitoringInsightsFilterOptions,
} from "@/lib/monitoring-insights.functions";

export const Route = createFileRoute("/monitoring")({
  head: () => ({
    meta: [
      { title: "Monitoring Insights — แดชบอร์ดการตรวจสอบป้าย" },
      { name: "description", content: "วิเคราะห์ผลการตรวจสอบ Monitoring และ Claim ภาพรวมทุกป้าย" },
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
  "oklch(0.65 0.15 200)",
  "oklch(0.7 0.12 30)",
];

const PASS_COLOR = "oklch(0.65 0.18 150)"; // green
const FAIL_COLOR = "oklch(0.6 0.22 25)"; // red

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
      : value.length <= 3
        ? value.join(", ")
        : `${value.slice(0, 2).join(", ")} +${value.length - 2}`;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={value.length ? value.join(", ") : "ทั้งหมด"}
        className="w-full inline-flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent"
      >
        <span className="truncate text-left">
          <span className="text-muted-foreground">{label}:</span>{" "}
          <span className="font-medium">{summary}</span>
          {value.length > 0 && (
            <span className="text-muted-foreground"> ({value.length})</span>
          )}
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute z-20 mt-1 max-h-72 w-72 overflow-auto rounded-md border bg-popover p-2 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between px-1 pb-2 text-xs">
              <button className="text-primary" onClick={() => onChange(options)}>เลือกทั้งหมด</button>
              <button className="text-muted-foreground" onClick={() => onChange([])}>ล้าง</button>
            </div>
            {options.map((o) => {
              const checked = value.includes(o);
              return (
                <label key={o} className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      onChange(checked ? value.filter((v) => v !== o) : [...value, o])
                    }
                  />
                  <span className="truncate">{o}</span>
                </label>
              );
            })}
            <div className="sticky bottom-0 pt-2 mt-2 border-t bg-popover">
              <button
                type="button"
                className="w-full rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
                onClick={() => setOpen(false)}
              >
                เสร็จ ({value.length} รายการ)
              </button>
            </div>
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
    <div className="relative">
      <Input
        placeholder="พิมพ์รหัสป้ายเพื่อค้นหา..."
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
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
      {showPanel && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border bg-popover text-popover-foreground shadow-md p-1 max-h-60 overflow-auto">
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
        </div>
      )}
    </div>
  );
});

type AppliedFilters = {
  departments: string[];
  zones: string[];
  projects: string[];
  mediaTypes: string[];
  fromDate: string;
  toDate: string;
  assetSearch: string;
};

function MonitoringPage() {
  const fn = useServerFn(getMonitoringInsights);
  const optsFn = useServerFn(getMonitoringInsightsFilterOptions);
  const qc = useQueryClient();
  const today = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  const yearStartStr = `${today.getFullYear()}-01-01`;

  const [departments, setDepartments] = useState<string[]>([]);
  const [zones, setZones] = useState<string[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [mediaTypes, setMediaTypes] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState(yearStartStr);
  const [toDate, setToDate] = useState(todayStr);
  const [assetSearchDraft, setAssetSearchDraft] = useState("");

  const [applied, setApplied] = useState<AppliedFilters | null>(null);
  const [bucketSel, setBucketSel] = useState<string[]>([]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["monitoring-insights", applied],
    queryFn: () =>
      fn({
        data: {
          departments: applied!.departments,
          zones: applied!.zones,
          projects: applied!.projects,
          mediaTypes: applied!.mediaTypes,
          fromDate: applied!.fromDate,
          toDate: applied!.toDate,
          assetCode: applied!.assetSearch || null,
        },
      }),
    enabled: applied !== null,
    staleTime: 5 * 60_000,
  });

  const { data: optionsData } = useQuery({
    queryKey: ["monitoring-insights-filter-options"],
    queryFn: () => optsFn(),
    staleTime: 10 * 60_000,
  });

  const filterOptionsRaw =
    optionsData ?? data?.filters ?? { departments: [], zones: [], projects: [], mediaTypes: [] };
  const assetMeta = optionsData?.assetMeta ?? [];

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
    setBucketSel([]);
    setApplied({
      departments,
      zones,
      projects,
      mediaTypes,
      fromDate,
      toDate,
      assetSearch: assetSearchDraft.trim(),
    });
  };
  const handleReset = () => {
    setDepartments([]); setZones([]); setProjects([]); setMediaTypes([]);
    setFromDate(yearStartStr); setToDate(todayStr); setAssetSearchDraft("");
    setBucketSel([]); setApplied(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="size-6 text-primary" /> Monitoring Insights
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            วิเคราะห์ผลการตรวจสอบ Monitoring และผลกระทบกับ Claim ภาพรวมทุกป้าย
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: ["monitoring-insights"] })}
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
              <label className="text-xs text-muted-foreground">กลุ่มสื่อ (Project)</label>
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
              <AssetCodeCombobox value={assetSearchDraft} onChange={setAssetSearchDraft} options={assetCodeOptions} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">วันที่เริ่ม</label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">ถึงวันที่</label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
            <p className="text-xs text-muted-foreground">
              {applied === null
                ? "ตั้งค่าตัวกรองให้ครบ แล้วกดปุ่ม “แสดงข้อมูล” เพื่อโหลดทุกกราฟและตารางพร้อมกัน"
                : "ตัวกรองปัจจุบันถูกใช้กับทุกกราฟและตารางในหน้านี้"}
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : data ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <KpiCard
              icon={Activity}
              label="จำนวน Monitoring ทั้งหมด (ตั๋ว)"
              value={data.kpi.monTickets ?? 0}
              color="text-blue-500"
              description="นับจำนวนตั๋ว Monitoring ทั้งหมดที่ผ่านตัวกรองด้านบน (ทุกสถานะ)"
            />
            <KpiCard
              icon={CheckCircle2}
              label="Asset Status: Pass"
              value={data.kpi.monPass ?? 0}
              color="text-emerald-500"
              description="จำนวนตั๋ว Monitoring ที่ asset_status = Pass"
            />
            <KpiCard
              icon={AlertCircle}
              label="Asset Status: Fail"
              value={data.kpi.monFail ?? 0}
              color="text-rose-500"
              description="จำนวนตั๋ว Monitoring ที่ asset_status = Fail"
            />
            <KpiCard
              icon={PackageOpen}
              label="Asset Status: Skip"
              value={data.kpi.monSkip ?? 0}
              color="text-amber-500"
              description="จำนวนตั๋ว Monitoring ที่ asset_status = On Skip"
            />
            <KpiCard
              icon={Clock}
              label="ระยะเวลา Monitoring เฉลี่ย (วัน)"
              value={data.kpi.monAvgGapDays ?? 0}
              color="text-violet-500"
              description="ค่าเฉลี่ยจำนวนวันระหว่างการ Monitor ครั้งติดกันของป้ายเดียวกัน"
            />
          </div>

          <MonRowsList rows={data.monRows} total={data.monRowsTotal} monthly={data.monthly} />
          <MonthlyChart data={data.monthly} details={data.monthlyDetails} />
          <AgingReport
            aging={data.aging}
            pairs={data.pairs}
            bucketSel={bucketSel}
            onBucketSel={setBucketSel}
          />
          <MonCalendarView days={data.calendarDays ?? []} />
        </>
      ) : null}
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, color, description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
  description?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="text-3xl font-bold mt-1 tabular-nums">{value.toLocaleString()}</div>
            {description && <p className="text-[11px] text-muted-foreground mt-2 leading-snug">{description}</p>}
          </div>
          <Icon className={`size-8 shrink-0 ${color}`} />
        </div>
      </CardContent>
    </Card>
  );
}

type MonthTicket = {
  ticket: string;
  assetCode: string;
  date: string;
  status: string;
  category: string;
  department: string;
};

function MonthlyChart({
  data, details,
}: {
  data: { month: string; pm: number; claim: number }[];
  details: { month: string; pm: MonthTicket[]; claim: MonthTicket[] }[];
}) {
  const year = new Date().getFullYear();
  const [selected, setSelected] = useState<string | null>(null);
  const selDetail = useMemo(() => details.find((d) => d.month === selected), [details, selected]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>จำนวนตั๋ว Monitoring และ Claim รายเดือน</CardTitle>
        <div className="text-sm text-muted-foreground mt-1 space-y-1">
          <p>นับตั๋วของปี {year}:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><b>แท่งเขียว (Monitoring)</b> = จำนวนตั๋ว Monitoring ที่ UpdatedDate อยู่ในเดือนนั้น</li>
            <li><b>แท่งแดง (Claim)</b> = จำนวนตั๋ว Claim ที่ CreatedDate อยู่ในเดือนนั้น</li>
          </ul>
          <p className="text-xs">💡 <b>คลิกที่แท่งกราฟ</b> เพื่อดูรายการป้ายของเดือนนั้น</p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart
              data={data}
              onClick={(s: { activeLabel?: string } | null) => {
                const lbl = s?.activeLabel;
                if (!lbl) return;
                setSelected((cur) => (cur === lbl ? null : lbl));
              }}
            >
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="pm" name="Monitoring" fill={PASS_COLOR} radius={[6, 6, 0, 0]} style={{ cursor: "pointer" }} />
              <Bar dataKey="claim" name="Claim" fill={FAIL_COLOR} radius={[6, 6, 0, 0]} style={{ cursor: "pointer" }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {selDetail && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">
                รายการตั๋วของเดือน {selDetail.month} {year} (Monitoring: {selDetail.pm.length} · Claim: {selDetail.claim.length})
              </h4>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                <ChevronUp className="size-4" /> ซ่อน
              </Button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <MonthTicketTable title="Monitoring" color="text-green-600" rows={selDetail.pm} />
              <MonthTicketTable title="Claim" color="text-rose-600" rows={selDetail.claim} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MonthTicketTable({ title, color, rows }: { title: string; color: string; rows: MonthTicket[] }) {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, totalPages);
  const slice = rows.slice((cur - 1) * pageSize, cur * pageSize);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`text-sm ${color}`}>{title} ({rows.length.toLocaleString()})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>วันที่</TableHead>
                <TableHead>รหัสป้าย</TableHead>
                <TableHead>หมวด</TableHead>
                <TableHead>สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slice.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">ไม่มีข้อมูล</TableCell></TableRow>
              ) : slice.map((r, i) => (
                <TableRow key={`${r.assetCode}-${i}`}>
                  <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                  <TableCell className="font-mono text-xs">{r.assetCode}</TableCell>
                  <TableCell className="text-xs">{r.category}</TableCell>
                  <TableCell className="text-xs">{r.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-2 text-xs">
            <span className="text-muted-foreground">หน้า {cur} / {totalPages}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>ก่อน</Button>
              <Button size="sm" variant="outline" disabled={cur >= totalPages} onClick={() => setPage(cur + 1)}>ถัดไป</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type MonRowItem = {
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

const MON_COLS: { key: keyof MonRowItem; label: string; mono?: boolean; nowrap?: boolean }[] = [
  { key: "assetCode", label: "Old Code", mono: true },
  { key: "assetName", label: "ชื่อ" },
  { key: "project", label: "Project" },
  { key: "zone", label: "Zone" },
  { key: "mediaType", label: "Media Type" },
  { key: "department", label: "แผนก" },
  { key: "category", label: "Category" },
  { key: "problemCategory", label: "Problem Cat." },
  { key: "problemDetail", label: "อาการ" },
  { key: "createdDate", label: "Created", nowrap: true },
  { key: "updatedDate", label: "Updated", nowrap: true },
  { key: "ticketStatus", label: "Ticket Status" },
  { key: "assetStatus", label: "Asset Status" },
  { key: "assetActive", label: "Asset" },
];

function MonRowsList({
  rows, total, monthly,
}: {
  rows: MonRowItem[];
  total: number;
  monthly: { month: string; pm: number; claim: number }[];
}) {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 50 | 100 | 200>(50);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(["category", "assetActive"]));
  const [showColPanel, setShowColPanel] = useState(false);
  const toggleHide = (k: string) =>
    setHidden((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  const visibleCols = MON_COLS.filter((c) => !hidden.has(c.key as string));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      r.assetCode.toLowerCase().includes(s) ||
      r.department.toLowerCase().includes(s) ||
      r.problemDetail.toLowerCase().includes(s) ||
      r.problemCategory.toLowerCase().includes(s) ||
      r.ticketStatus.toLowerCase().includes(s),
    );
  }, [rows, q]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, totalPages);
  const slice = filtered.slice((cur - 1) * pageSize, cur * pageSize);

  const exportCsv = () => {
    const header = visibleCols.map((c) => c.label);
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      header.join(","),
      ...filtered.map((r) => visibleCols.map((c) => esc(String(r[c.key] ?? ""))).join(",")),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monitoring-rows-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const truncated = total > rows.length;
  const monOnly = monthly.map((m) => ({ month: m.month, monitoring: m.pm }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">
            รายการ Monitoring ทั้งหมด ({total.toLocaleString()}{truncated ? ` · แสดง ${rows.length.toLocaleString()}` : ""})
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
              Export CSV
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
              {open ? <><ChevronUp className="size-4" /> ซ่อน</> : <><ChevronDown className="size-4" /> แสดงรายการ</>}
            </Button>
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div>
            <div className="text-sm font-medium mb-2">แนวโน้มรายเดือน — Monitoring (ครบ 12 เดือน)</div>
            <div className="h-56">
              <ResponsiveContainer>
                <LineChart data={monOnly}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="month" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="monitoring" name="Monitoring" stroke={PASS_COLOR} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <Input
              placeholder="ค้นหา รหัสป้าย / แผนก / อาการ / สถานะ"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              className="max-w-md"
            />
            <div className="relative">
              <Button variant="outline" size="sm" onClick={() => setShowColPanel((v) => !v)}>
                จัดการคอลัมน์
                {hidden.size > 0 && (
                  <span className="ml-1 rounded-full bg-primary text-primary-foreground px-1.5 py-0.5 text-[10px]">
                    ซ่อน {hidden.size}
                  </span>
                )}
                <ChevronDown className="size-3" />
              </Button>
              {showColPanel && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowColPanel(false)} />
                  <div className="absolute right-0 z-40 mt-1 w-64 rounded-lg border bg-popover shadow-lg p-3 max-h-[60vh] overflow-auto">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold">คอลัมน์ที่แสดง</div>
                      <button onClick={() => setHidden(new Set())} className="text-[11px] text-primary hover:underline">
                        แสดงทั้งหมด
                      </button>
                    </div>
                    <div className="space-y-1">
                      {MON_COLS.map((c) => (
                        <label key={c.key as string} className="flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-accent cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!hidden.has(c.key as string)}
                            onChange={() => toggleHide(c.key as string)}
                          />
                          <span>{c.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="overflow-x-auto border rounded">
            <Table>
              <TableHeader>
                <TableRow>
                  {visibleCols.map((c) => (
                    <TableHead key={c.key as string} className="whitespace-nowrap">{c.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {slice.length === 0 ? (
                  <TableRow><TableCell colSpan={visibleCols.length} className="text-center text-muted-foreground py-4">ไม่มีข้อมูล</TableCell></TableRow>
                ) : slice.map((r, i) => (
                  <TableRow key={`${r.assetCode}-${i}`}>
                    {visibleCols.map((c) => (
                      <TableCell
                        key={c.key as string}
                        className={
                          "text-xs " +
                          (c.mono ? "font-mono " : "") +
                          (c.nowrap ? "whitespace-nowrap " : "")
                        }
                      >
                        {String(r[c.key] ?? "")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between mt-2 text-xs flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">แสดงต่อหน้า:</span>
              {[20, 50, 100, 200].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => { setPageSize(n as 20 | 50 | 100 | 200); setPage(1); }}
                  className={
                    "px-2 py-1 rounded border transition " +
                    (pageSize === n
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-accent border-border")
                  }
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="text-muted-foreground">หน้า {cur} / {totalPages} · {filtered.length.toLocaleString()} รายการ</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>ก่อน</Button>
              <Button size="sm" variant="outline" disabled={cur >= totalPages} onClick={() => setPage(cur + 1)}>ถัดไป</Button>
            </div>
          </div>
          {truncated && (
            <div className="mt-2 text-xs text-amber-600">
              * แสดง {rows.length.toLocaleString()} แถวแรกจากทั้งหมด {total.toLocaleString()} — ใช้ Export CSV เพื่อโหลดทั้งหมด
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

type AgingPair = {
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

const BUCKET_RANGES: Record<string, [number, number]> = {
  "1-3": [1, 3], "4-7": [4, 7], "8-15": [8, 15], "16-30": [16, 30], "31-60": [31, 60], "61-90": [61, 90],
};

type DonutKey = "problemCategory" | "problemDetail" | "problemEquipment" | "solutionCategory" | "solutionDetail";
const DONUT_DEFS: { key: DonutKey; title: string }[] = [
  { key: "problemCategory", title: "Problem Category" },
  { key: "problemDetail", title: "Problem Detail" },
  { key: "problemEquipment", title: "Problem Equipment" },
  { key: "solutionCategory", title: "Solution Category" },
  { key: "solutionDetail", title: "Solution Detail" },
];

function AgingReport({
  aging, pairs, bucketSel, onBucketSel,
}: {
  aging: { bucket: string; count: number }[];
  pairs: AgingPair[];
  bucketSel: string[];
  onBucketSel: (b: string[]) => void;
}) {
  const [sel, setSel] = useState<Record<DonutKey, string | null>>({
    problemCategory: null, problemDetail: null, problemEquipment: null, solutionCategory: null, solutionDetail: null,
  });
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const inSelectedBuckets = (days: number): boolean => {
    if (bucketSel.length === 0) return false;
    for (const b of bucketSel) {
      const r = BUCKET_RANGES[b];
      if (r && days >= r[0] && days <= r[1]) return true;
    }
    return false;
  };

  const early = useMemo(() => {
    if (bucketSel.length > 0) return pairs.filter((p) => inSelectedBuckets(p.days));
    return pairs.filter((p) => p.days <= 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs, bucketSel]);
  const totalPairs = aging.reduce((s, b) => s + b.count, 0);

  const donutData = useMemo(() => {
    const out: Record<DonutKey, { name: string; value: number }[]> = {
      problemCategory: [], problemDetail: [], problemEquipment: [], solutionCategory: [], solutionDetail: [],
    };
    for (const def of DONUT_DEFS) {
      const filtered = early.filter((p) =>
        DONUT_DEFS.every((d) => d.key === def.key ? true : !sel[d.key] || p[d.key] === sel[d.key]),
      );
      const m = new Map<string, number>();
      for (const p of filtered) {
        const v = p[def.key];
        m.set(v, (m.get(v) ?? 0) + 1);
      }
      out[def.key] = Array.from(m.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12);
    }
    return out;
  }, [early, sel]);

  const activeDonutFilters = DONUT_DEFS.filter((d) => sel[d.key]);

  const tablePairs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pairs.filter((p) => {
      if (bucketSel.length > 0 && !inSelectedBuckets(p.days)) return false;
      for (const d of DONUT_DEFS) {
        if (sel[d.key] && p[d.key] !== sel[d.key]) return false;
      }
      if (
        q &&
        !p.assetCode.toLowerCase().includes(q) &&
        !p.department.toLowerCase().includes(q) &&
        !p.mediaType.toLowerCase().includes(q) &&
        !p.problemDetail.toLowerCase().includes(q) &&
        !p.problemCategory.toLowerCase().includes(q)
      ) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs, bucketSel, sel, search]);

  const totalPages = Math.max(1, Math.ceil(tablePairs.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const visible = tablePairs.slice(start, start + pageSize);

  const toggleBucket = (b: string) => {
    if (bucketSel.includes(b)) onBucketSel(bucketSel.filter((x) => x !== b));
    else onBucketSel([...bucketSel, b]);
    setPage(1);
  };

  const bucketLabel = bucketSel.length === 0 ? null : bucketSel.join(", ");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monitoring → Claim Aging</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          จับคู่ Monitoring (assetStatus = Pass) กับ Claim ครั้งถัดไปของป้ายเดียวกัน · รวม <span className="font-semibold text-foreground">{totalPairs}</span> คู่ ·
          แท่ง 1–3, 4–7 วัน = Critical · <b> คลิกแท่งกราฟหรือชิปเพื่อเลือกได้หลายช่วง</b>
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={aging}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="bucket" />
              <YAxis />
              <Tooltip />
              <Bar
                dataKey="count"
                radius={[8, 8, 0, 0]}
                cursor="pointer"
                onClick={(d: { bucket?: string }) => { if (!d?.bucket) return; toggleBucket(d.bucket); }}
              >
                {aging.map((entry, i) => {
                  const isSelected = bucketSel.includes(entry.bucket);
                  const isCritical = entry.bucket === "1-3" || entry.bucket === "4-7";
                  return (
                    <Cell
                      key={i}
                      fill={isCritical ? FAIL_COLOR : PASS_COLOR}
                      opacity={bucketSel.length === 0 || isSelected ? 1 : 0.35}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-xs text-muted-foreground">เลือกช่วง:</span>
          {aging.map((a) => {
            const active = bucketSel.includes(a.bucket);
            return (
              <button
                key={a.bucket}
                type="button"
                onClick={() => toggleBucket(a.bucket)}
                className={
                  "text-[11px] px-2 py-1 rounded border transition " +
                  (active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent text-foreground border-border")
                }
              >
                {a.bucket} วัน ({a.count})
              </button>
            );
          })}
          {bucketSel.length > 0 && (
            <button onClick={() => onBucketSel([])} className="text-[11px] text-muted-foreground hover:text-foreground underline ml-1">
              ล้างช่วง
            </button>
          )}
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div>
              <h4 className="font-semibold text-sm">
                อาการ/วิธีแก้ที่พบบ่อย {bucketLabel ? `(ช่วง ${bucketLabel} วัน)` : "(เฉพาะ Claim ภายใน 30 วันหลัง Monitoring)"}
              </h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {bucketLabel
                  ? `นับเฉพาะคู่ Monitoring→Claim ที่อยู่ในช่วง ${bucketLabel} วัน (${early.length} คู่)`
                  : `นับจำนวนคู่ Monitoring→Claim ที่ห่างกัน ≤ 30 วัน (${early.length} คู่)`}
              </p>
            </div>
            {activeDonutFilters.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {activeDonutFilters.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => setSel((s) => ({ ...s, [d.key]: null }))}
                    className="text-[11px] px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    {d.title}: {sel[d.key]} ✕
                  </button>
                ))}
                <button
                  onClick={() => setSel({ problemCategory: null, problemDetail: null, problemEquipment: null, solutionCategory: null, solutionDetail: null })}
                  className="text-[11px] text-muted-foreground hover:text-foreground underline"
                >
                  ล้างทั้งหมด
                </button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {DONUT_DEFS.map((d) => (
              <DonutPanel
                key={d.key}
                title={d.title}
                data={donutData[d.key]}
                selected={sel[d.key]}
                onSelect={(name) => setSel((s) => ({ ...s, [d.key]: s[d.key] === name ? null : name }))}
              />
            ))}
          </div>
        </div>

        <div className="mt-8 border-t pt-6">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <div>
              <h4 className="font-semibold text-base">รายละเอียดคู่ Monitoring → Claim</h4>
              <p className="text-sm text-muted-foreground mt-1">
                รวม <b>{tablePairs.length.toLocaleString()}</b> คู่
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="ค้นหารหัสป้าย / แผนก / Media Type / อาการ"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-80"
              />
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20 / หน้า</SelectItem>
                  <SelectItem value="50">50 / หน้า</SelectItem>
                  <SelectItem value="100">100 / หน้า</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="overflow-auto border rounded">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>รหัสป้าย</TableHead>
                  <TableHead>Media Type</TableHead>
                  <TableHead>แผนก</TableHead>
                  <TableHead>วัน Monitoring</TableHead>
                  <TableHead>วัน Claim</TableHead>
                  <TableHead className="text-right">ห่าง (วัน)</TableHead>
                  <TableHead>หมวดอาการ</TableHead>
                  <TableHead>อาการ</TableHead>
                  <TableHead>อุปกรณ์</TableHead>
                  <TableHead>วิธีแก้ (หมวด)</TableHead>
                  <TableHead>วิธีแก้</TableHead>
                  <TableHead>สถานะ Ticket</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">ไม่พบข้อมูล</TableCell></TableRow>
                ) : visible.map((p, i) => (
                  <TableRow key={start + i} className={p.days <= 7 ? "bg-red-50 dark:bg-red-950/30" : ""}>
                    <TableCell className="font-mono text-xs">{p.assetCode}</TableCell>
                    <TableCell className="text-xs">{p.mediaType}</TableCell>
                    <TableCell className="text-xs">{p.department}</TableCell>
                    <TableCell className="text-xs">{p.pmDate}</TableCell>
                    <TableCell className="text-xs">{p.claimDate}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.days <= 7 ? <Badge tone="danger">{p.days} · Critical</Badge> : p.days}
                    </TableCell>
                    <TableCell className="text-xs max-w-[140px] truncate" title={p.problemCategory}>{p.problemCategory}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate" title={p.problemDetail}>{p.problemDetail}</TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate" title={p.problemEquipment}>{p.problemEquipment}</TableCell>
                    <TableCell className="text-xs max-w-[140px] truncate" title={p.solutionCategory}>{p.solutionCategory}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate" title={p.solutionDetail}>{p.solutionDetail}</TableCell>
                    <TableCell className="text-xs">{p.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <div>
              แสดง {tablePairs.length === 0 ? 0 : start + 1}–{Math.min(start + pageSize, tablePairs.length)} จาก {tablePairs.length.toLocaleString()}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(1)}>«</Button>
              <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>ก่อนหน้า</Button>
              <span className="px-2 tabular-nums">หน้า {currentPage} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>ถัดไป</Button>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)}>»</Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DonutPanel({
  title, data, selected, onSelect,
}: {
  title: string;
  data: { name: string; value: number }[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  if (!data.length) {
    return <div className="text-xs text-muted-foreground text-center py-8 border rounded">{title}<br />ไม่มีข้อมูล</div>;
  }
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs font-medium text-center mb-2">{title}</div>
      <div className="h-40">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={30}
              outerRadius={55}
              paddingAngle={2}
              onClick={(d: { name?: string }) => d?.name && onSelect(d.name)}
            >
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={PIE_COLORS[i % PIE_COLORS.length]}
                  opacity={!selected || selected === d.name ? 1 : 0.3}
                  cursor="pointer"
                />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 space-y-1 max-h-28 overflow-auto">
        {data.map((d, i) => {
          const isSel = selected === d.name;
          return (
            <button
              key={i}
              onClick={() => onSelect(d.name)}
              className={
                "w-full flex items-center gap-1.5 text-[11px] px-1 py-0.5 rounded hover:bg-accent text-left " +
                (isSel ? "bg-primary/10 font-medium" : "")
              }
            >
              <span className="size-2 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
              <span className="truncate flex-1" title={d.name}>{d.name}</span>
              <span className="tabular-nums text-muted-foreground">{d.value}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type CalendarDay = {
  date: string;
  pass: number;
  fail: number;
  passCodes: string[];
  failCodes: string[];
};

const TH_MONTH_NAMES = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const TH_WEEKDAY = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function ymKey(y: number, m: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}
function parseYm(s: string): { y: number; m: number } {
  const [y, m] = s.split("-").map(Number);
  return { y, m: m - 1 };
}
function buildYmOptions(): { value: string; label: string }[] {
  const now = new Date();
  const baseY = now.getFullYear();
  const out: { value: string; label: string }[] = [];
  for (let y = baseY - 5; y <= baseY + 1; y++) {
    for (let m = 0; m < 12; m++) {
      out.push({ value: ymKey(y, m), label: `${TH_MONTH_NAMES[m]} ${y + 543}` });
    }
  }
  return out;
}

function MonCalendarView({ days }: { days: CalendarDay[] }) {
  const now = new Date();
  const defaultTo = ymKey(now.getFullYear(), now.getMonth());
  const startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const defaultFrom = ymKey(startDate.getFullYear(), startDate.getMonth());

  const [fromYm, setFromYm] = useState<string>(defaultFrom);
  const [toYm, setToYm] = useState<string>(defaultTo);
  const [search, setSearch] = useState("");

  const ymOptions = useMemo(buildYmOptions, []);

  const monthsList = useMemo(() => {
    const from = parseYm(fromYm);
    const to = parseYm(toYm);
    let fromIdx = from.y * 12 + from.m;
    let toIdx = to.y * 12 + to.m;
    if (fromIdx > toIdx) [fromIdx, toIdx] = [toIdx, fromIdx];
    const arr: { y: number; m: number }[] = [];
    for (let i = fromIdx; i <= toIdx && arr.length < 36; i++) {
      arr.push({ y: Math.floor(i / 12), m: i % 12 });
    }
    return arr;
  }, [fromYm, toYm]);

  const dayMap = useMemo(() => {
    const q = search.trim().toLowerCase();
    const m = new Map<string, CalendarDay>();
    for (const d of days) {
      if (q) {
        const hit =
          d.passCodes.some((c) => c.toLowerCase().includes(q)) ||
          d.failCodes.some((c) => c.toLowerCase().includes(q));
        if (!hit) continue;
      }
      m.set(d.date, d);
    }
    return m;
  }, [days, search]);

  const totals = useMemo(() => {
    let pass = 0, fail = 0;
    for (const v of dayMap.values()) {
      pass += v.pass;
      fail += v.fail;
    }
    return { pass, fail };
  }, [dayMap]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>ปฏิทินผลการ Monitoring (Pass / Fail)</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              <span className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: PASS_COLOR }} />Pass
              {" · "}
              <span className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: FAIL_COLOR }} />Fail
              {" · ใช้วันที่ Update ของแต่ละ ticket Monitoring · เลื่อนเมาส์ที่ตัวเลขเพื่อดูรหัสป้าย"}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">จาก</span>
              <Select value={fromYm} onValueChange={setFromYm}>
                <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-80">
                  {ymOptions.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">ถึง</span>
              <Select value={toYm} onValueChange={setToYm}>
                <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-80">
                  {ymOptions.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <Input placeholder="ค้นหารหัสป้าย" value={search} onChange={(e) => setSearch(e.target.value)} className="w-44 h-9" />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 mt-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: PASS_COLOR }} />
            <span>Pass</span>
            <span className="text-muted-foreground">({totals.pass.toLocaleString()})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: FAIL_COLOR }} />
            <span>Fail</span>
            <span className="text-muted-foreground">({totals.fail.toLocaleString()})</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {monthsList.map((mo) => (
            <MonthCell key={`${mo.y}-${mo.m}`} year={mo.y} month={mo.m} dayMap={dayMap} />
          ))}
        </div>
        {monthsList.length === 0 && (
          <div className="text-center text-muted-foreground py-6 text-sm">เลือกช่วงเดือนเริ่ม–สิ้นสุดเพื่อแสดงปฏิทิน</div>
        )}
      </CardContent>
    </Card>
  );
}

function MonthCell({
  year, month, dayMap,
}: { year: number; month: number; dayMap: Map<string, CalendarDay> }) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  let monthPass = 0, monthFail = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const v = dayMap.get(key);
    if (v) { monthPass += v.pass; monthFail += v.fail; }
  }

  return (
    <div className="border rounded-lg p-2.5 bg-card">
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-semibold text-sm">
          {TH_MONTH_NAMES[month]} <span className="text-muted-foreground font-normal">{year + 543}</span>
        </div>
        <div className="flex gap-1.5 text-[10px]">
          {monthPass > 0 && (
            <span className="px-1.5 rounded" style={{ background: "oklch(0.65 0.18 150 / 0.15)", color: "oklch(0.45 0.18 150)" }}>Pass {monthPass}</span>
          )}
          {monthFail > 0 && (
            <span className="px-1.5 rounded" style={{ background: "oklch(0.6 0.22 25 / 0.15)", color: "oklch(0.5 0.2 25)" }}>Fail {monthFail}</span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-[10px] text-muted-foreground mb-1">
        {TH_WEEKDAY.map((w, i) => (<div key={i} className="text-center font-medium">{w}</div>))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="aspect-square" />;
          const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const v = dayMap.get(key);
          const hasPass = !!v && v.pass > 0;
          const hasFail = !!v && v.fail > 0;
          const tip = v
            ? [
                hasPass ? `Pass (${v.pass}): ${v.passCodes.join(", ")}${v.pass > v.passCodes.length ? "..." : ""}` : "",
                hasFail ? `Fail (${v.fail}): ${v.failCodes.join(", ")}${v.fail > v.failCodes.length ? "..." : ""}` : "",
              ].filter(Boolean).join("\n")
            : "";
          return (
            <div
              key={i}
              title={tip || undefined}
              className={`aspect-square rounded text-[10px] flex flex-col items-center justify-start py-0.5 px-0.5 border ${
                v ? "border-border" : "border-transparent"
              } ${hasPass && hasFail ? "bg-muted/40" : ""}`}
            >
              <div className="text-foreground/70 leading-none">{d}</div>
              <div className="flex flex-col gap-0.5 mt-0.5 items-center">
                {hasPass && (
                  <span className="text-[9px] leading-none px-1 rounded-sm text-white font-medium" style={{ background: PASS_COLOR }}>{v!.pass}</span>
                )}
                {hasFail && (
                  <span className="text-[9px] leading-none px-1 rounded-sm text-white font-medium" style={{ background: FAIL_COLOR }}>{v!.fail}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
