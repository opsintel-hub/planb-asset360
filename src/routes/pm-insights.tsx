import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { getPmInsights, getPmInsightsFilterOptions } from "@/lib/pm-insights.functions";
import { BarChart3, Building2, Wrench, Monitor, PackageOpen, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/pm-insights")({
  head: () => ({
    meta: [
      { title: "PM Insights — แดชบอร์ดประสิทธิภาพ PM" },
      { name: "description", content: "วิเคราะห์ประสิทธิภาพ PM และ Claim ภาพรวมทั้งบริษัท" },
    ],
  }),
  component: PmInsightsPage,
});

const PIE_COLORS = [
  "oklch(0.66 0.18 250)",
  "oklch(0.72 0.17 60)",
  "oklch(0.68 0.18 25)",
  "oklch(0.7 0.14 160)",
  "oklch(0.7 0.18 320)",
  "oklch(0.75 0.14 100)",
  "oklch(0.65 0.15 200)",
  "oklch(0.7 0.12 30)",
];

function MultiSelect({
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
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full inline-flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent"
      >
        <span className="truncate">
          {label}: {value.length === 0 ? "ทั้งหมด" : `${value.length} รายการ`}
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
}

type AppliedFilters = {
  departments: string[];
  zones: string[];
  projects: string[];
  mediaTypes: string[];
  pmCategory: "all" | "media" | "non-media";
  fromDate: string;
  toDate: string;
  assetSearch: string;
};

function PmInsightsPage() {
  const fn = useServerFn(getPmInsights);
  const optsFn = useServerFn(getPmInsightsFilterOptions);
  const qc = useQueryClient();
  const today = new Date();
  const default90 = new Date(today.getTime() - 90 * 86400_000);

  // Draft filter state (not applied until user clicks the button)
  const [departments, setDepartments] = useState<string[]>([]);
  const [zones, setZones] = useState<string[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [mediaTypes, setMediaTypes] = useState<string[]>([]);
  const [pmCategory, setPmCategory] = useState<"all" | "media" | "non-media">("all");
  const [fromDate, setFromDate] = useState(default90.toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(today.toISOString().slice(0, 10));
  const [assetSearchDraft, setAssetSearchDraft] = useState("");

  // Applied filter state — query only runs / page only renders when this is set
  const [applied, setApplied] = useState<AppliedFilters | null>(null);
  // Multi-select aging buckets (empty = default ≤30 view, no table filter)
  const [bucketSel, setBucketSel] = useState<string[]>([]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["pm-insights", applied],
    queryFn: () =>
      fn({
        data: {
          departments: applied!.departments,
          zones: applied!.zones,
          projects: applied!.projects,
          mediaTypes: applied!.mediaTypes,
          pmCategory: applied!.pmCategory,
          fromDate: applied!.fromDate,
          toDate: applied!.toDate,
          assetCode: applied!.assetSearch || null,
        },
      }),
    enabled: applied !== null,
    staleTime: 5 * 60_000,
  });

  // Lightweight options query — fast, fetched on mount so dropdowns are
  // immediately responsive without waiting for the heavy insights computation.
  const { data: optionsData } = useQuery({
    queryKey: ["pm-insights-filter-options"],
    queryFn: () => optsFn(),
    staleTime: 10 * 60_000,
  });

  const filterOptions =
    optionsData ??
    data?.filters ?? { departments: [], zones: [], projects: [], mediaTypes: [] };
  const assetCodeOptions = useMemo(() => {
    if (optionsData?.assetCodes) return optionsData.assetCodes;
    const set = new Set<string>();
    for (const r of data?.frequency ?? []) set.add(r.assetCode);
    for (const p of data?.pairs ?? []) set.add(p.assetCode);
    return Array.from(set).sort();
  }, [optionsData, data]);

  const handleApply = () => {
    setBucketSel([]);
    setApplied({
      departments,
      zones,
      projects,
      mediaTypes,
      pmCategory,
      fromDate,
      toDate,
      assetSearch: assetSearchDraft.trim(),
    });
  };

  const handleReset = () => {
    setDepartments([]);
    setZones([]);
    setProjects([]);
    setMediaTypes([]);
    setPmCategory("all");
    setFromDate(default90.toISOString().slice(0, 10));
    setToDate(today.toISOString().slice(0, 10));
    setAssetSearchDraft("");
    setBucketSel([]);
    setApplied(null);
  };



  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="size-6 text-primary" /> PM Insights
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            วิเคราะห์ประสิทธิภาพการทำ PM และผลกระทบจาก Claim ภาพรวมทุกป้าย
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: ["pm-insights"] })}
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
              <label className="text-xs text-muted-foreground" title="กรองตาม payload.Category ของ mssql_asset_history">
                ประเภท PM
              </label>
              <Select
                value={pmCategory}
                onValueChange={(v) => setPmCategory(v as "all" | "media" | "non-media")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทั้งหมด (Media + non Media)</SelectItem>
                  <SelectItem value="media">PM (Media)</SelectItem>
                  <SelectItem value="non-media">PM (non Media)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground" title="กลุ่มสื่อจาก mssql_asset_history.payload.Project">
                กลุ่มสื่อ (Project)
              </label>
              <MultiSelect
                label="กลุ่มสื่อ"
                options={filterOptions.projects}
                value={projects}
                onChange={setProjects}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">พื้นที่ (BKK/UPC)</label>
              <MultiSelect
                label="พื้นที่"
                options={filterOptions.zones}
                value={zones}
                onChange={setZones}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Media Type</label>
              <MultiSelect
                label="Media Type"
                options={filterOptions.mediaTypes}
                value={mediaTypes}
                onChange={setMediaTypes}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">ค้นหารหัสป้าย (Old Code)</label>
              <Input
                list="pm-asset-codes"
                placeholder="พิมพ์เพื่อค้นหา..."
                value={assetSearchDraft}
                onChange={(e) => setAssetSearchDraft(e.target.value)}
              />
              <datalist id="pm-asset-codes">
                {assetCodeOptions
                  .filter((c) =>
                    assetSearchDraft ? c.toLowerCase().includes(assetSearchDraft.toLowerCase()) : true,
                  )
                  .slice(0, 50)
                  .map((c) => (
                    <option key={c} value={c} />
                  ))}
              </datalist>
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
                : "ตัวกรองปัจจุบันถูกใช้กับทุกกราฟและตารางในหน้านี้ · ปรับค่าแล้วกด “อัปเดตข้อมูล” อีกครั้งเพื่อโหลดใหม่"}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleReset} disabled={isFetching}>
                ล้างค่า
              </Button>
              <Button size="sm" onClick={handleApply} disabled={isFetching}>
                {isFetching ? (
                  <>
                    <RefreshCw className="size-4 animate-spin" />
                    กำลังโหลด...
                  </>
                ) : applied === null ? (
                  "แสดงข้อมูล"
                ) : (
                  "อัปเดตข้อมูล"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {applied === null ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground space-y-2">
            <BarChart3 className="size-10 mx-auto opacity-40" />
            <p className="text-sm">ยังไม่มีข้อมูลแสดง</p>
            <p className="text-xs">
              กรุณาตั้งค่าตัวกรองด้านบน แล้วกดปุ่ม “แสดงข้อมูล” เพื่อเริ่มต้น
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* KPI Cards — 4 boxes */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={Building2}
              label="จำนวนป้ายทั้งหมด"
              value={data.kpi.assets}
              color="text-blue-500"
              description="นับ distinct asset_old_code จากตาราง assets (ไม่ขึ้นกับ filter วันที่)"
            />
            <KpiCard
              icon={Wrench}
              label="ป้ายที่เปิดตั๋ว PM ทั้งหมด"
              value={data.kpi.pmAll}
              color="text-green-500"
              description="นับ distinct asset_old_code ที่มี PM (Media) หรือ PM (non Media) ทุกสถานะในช่วง filter"
            />
            <KpiCard
              icon={Monitor}
              label="ป้ายที่เปิดตั๋ว PM (Media)"
              value={data.kpi.pmMedia}
              color="text-purple-500"
              description="นับเฉพาะ payload.Category = 'PM (Media)'"
            />
            <KpiCard
              icon={PackageOpen}
              label="ป้ายที่เปิดตั๋ว PM (non Media)"
              value={data.kpi.pmNonMedia}
              color="text-orange-500"
              description="นับเฉพาะ payload.Category = 'PM (non Media)'"
            />
          </div>

          {/* Monthly PM vs Claim (current year) */}
          <MonthlyChart data={data.monthly} />

          {/* Report 1: Aging chart + donuts + pairs table (merged) */}
          <AgingReport
            aging={data.aging}
            pairs={data.pairs}
            bucketSel={bucketSel}
            onBucketSel={setBucketSel}
          />


          {/* Report 3: Score */}
          <ScoreReport scoreRows={data.scoreRows} />

          {/* Report 4: Frequency */}
          <FrequencyReport
            rows={data.frequency}
            agg={data.freqAgg}
          />
        </>
      ) : null}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  color,
  description,
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
            {description && (
              <p className="text-[11px] text-muted-foreground mt-2 leading-snug">{description}</p>
            )}
          </div>
          <Icon className={`size-8 shrink-0 ${color}`} />
        </div>
      </CardContent>
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
};

const BUCKET_RANGES: Record<string, [number, number]> = {
  "1-3": [1, 3],
  "4-7": [4, 7],
  "8-15": [8, 15],
  "16-30": [16, 30],
  "31-60": [31, 60],
  "61-90": [61, 90],
  ">90": [91, 9e9],
};

function MonthlyChart({ data }: { data: { month: string; pm: number; claim: number }[] }) {
  const year = new Date().getFullYear();
  return (
    <Card>
      <CardHeader>
        <CardTitle>จำนวนตั๋ว PM และ Claim รายเดือน</CardTitle>
        <div className="text-sm text-muted-foreground mt-1 space-y-1">
          <p>นับจาก <b>วันที่เปิดตั๋ว (CreatedDate)</b> ของแต่ละตั๋ว แล้วจัดกลุ่มตามเดือนของปี {year}</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><b>แท่งเขียว (PM)</b> = จำนวนตั๋ว PM ทั้งหมดที่ถูกเปิดในเดือนนั้น (ทุกสถานะ ทั้ง Pass / Fail / In progress)</li>
            <li><b>แท่งแดง (Claim)</b> = จำนวนตั๋ว Claim ทั้งหมดที่ถูกเปิดในเดือนนั้น (ทุกสถานะ ทั้งปิดแล้วและยังค้าง)</li>
          </ul>
          <p>* กราฟนี้แสดงทั้งปี <b>โดยไม่สนใจช่วงวันที่ใน Filter ด้านบน</b> (แต่ยังกรองตาม แผนก / โซน / โปรเจกต์) เพื่อให้เห็นภาพรวมรายเดือนของทั้งปี</p>
        </div>
      </CardHeader>

      <CardContent>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="pm" name="PM" fill="oklch(0.7 0.14 160)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="claim" name="Claim" fill="oklch(0.6 0.2 25)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

type DonutKey =
  | "problemCategory"
  | "problemDetail"
  | "problemEquipment"
  | "solutionCategory"
  | "solutionDetail";

const DONUT_DEFS: { key: DonutKey; title: string }[] = [
  { key: "problemCategory", title: "Problem Category" },
  { key: "problemDetail", title: "Problem Detail" },
  { key: "problemEquipment", title: "Problem Equipment" },
  { key: "solutionCategory", title: "Solution Category" },
  { key: "solutionDetail", title: "Solution Detail" },
];

function AgingReport({
  aging,
  pairs,
  bucketSel,
  onBucketSel,
}: {
  aging: { bucket: string; count: number }[];
  pairs: AgingPair[];
  bucketSel: string[];
  onBucketSel: (b: string[]) => void;
}) {
  const [sel, setSel] = useState<Record<DonutKey, string | null>>({
    problemCategory: null,
    problemDetail: null,
    problemEquipment: null,
    solutionCategory: null,
    solutionDetail: null,
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

  // For each donut, filter by OTHER selections (slicer behavior)
  const donutData = useMemo(() => {
    const out: Record<DonutKey, { name: string; value: number }[]> = {
      problemCategory: [],
      problemDetail: [],
      problemEquipment: [],
      solutionCategory: [],
      solutionDetail: [],
    };
    for (const def of DONUT_DEFS) {
      const filtered = early.filter((p) =>
        DONUT_DEFS.every((d) =>
          d.key === def.key ? true : !sel[d.key] || p[d.key] === sel[d.key],
        ),
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

  // Pairs table: filter by bucket + donut selections + search
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
        !p.problemCategory.toLowerCase().includes(q) &&
        !p.pmTicket.toLowerCase().includes(q) &&
        !p.claimTicket.toLowerCase().includes(q)
      )
        return false;
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
        <CardTitle>PM Effectiveness & Aging</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          จับคู่ PM (assetStatus = Pass) กับ Claim ครั้งถัดไปของป้ายเดียวกัน แล้วนับจำนวน "คู่" ตามช่วงวันที่ห่างกัน
          · รวม <span className="font-semibold text-foreground">{totalPairs}</span> คู่ ·
          แท่ง 1–3, 4–7 วัน = Critical (PM แล้วเสียซ้ำเร็ว) ·
          <b> คลิกแท่งกราฟ หรือชิปด้านล่าง เพื่อเลือกได้หลายช่วง</b>
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
                onClick={(d: { bucket?: string }) => {
                  if (!d?.bucket) return;
                  toggleBucket(d.bucket);
                }}
              >
                {aging.map((entry, i) => {
                  const isSelected = bucketSel.includes(entry.bucket);
                  const isCritical = entry.bucket === "1-3" || entry.bucket === "4-7";
                  return (
                    <Cell
                      key={i}
                      fill={isCritical ? "oklch(0.6 0.2 25)" : "oklch(0.66 0.18 250)"}
                      opacity={bucketSel.length === 0 || isSelected ? 1 : 0.35}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Bucket multi-select chips */}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-xs text-muted-foreground">เลือกช่วง (กดได้หลายช่วง):</span>
          {aging.map((a) => {
            const active = bucketSel.includes(a.bucket);
            return (
              <button
                key={a.bucket}
                type="button"
                onClick={() => toggleBucket(a.bucket)}
                className={
                  "text-[11px] px-2 py-1 rounded border transition " +
                  (active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-accent text-foreground border-border")
                }
              >
                {a.bucket} วัน ({a.count})
              </button>
            );
          })}
          {bucketSel.length > 0 && (
            <button
              onClick={() => onBucketSel([])}
              className="text-[11px] text-muted-foreground hover:text-foreground underline ml-1"
            >
              ล้างช่วง
            </button>
          )}
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div>
              <h4 className="font-semibold text-sm">
                อาการ/วิธีแก้ที่พบบ่อย {bucketLabel ? `(ช่วง ${bucketLabel} วัน)` : "(เฉพาะ Claim ภายใน 30 วันหลัง PM)"}
              </h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {bucketLabel
                  ? `นับเฉพาะคู่ PM→Claim ที่อยู่ในช่วง ${bucketLabel} วัน (${early.length} คู่) · คลิกชิป/แท่งกราฟเพื่อเพิ่มหรือเอาช่วงออก`
                  : `นับจำนวนคู่ PM→Claim ที่ห่างกัน ≤ 30 วัน (${early.length} คู่) · คลิกชิปด้านบนเพื่อโฟกัสช่วงอื่น (เลือกได้หลายช่วง)`}
                 · คลิกชิ้นโดนัทเพื่อกรองตารางและ chart อื่น
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
                  onClick={() =>
                    setSel({
                      problemCategory: null,
                      problemDetail: null,
                      problemEquipment: null,
                      solutionCategory: null,
                      solutionDetail: null,
                    })
                  }
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
                onSelect={(name) =>
                  setSel((s) => ({ ...s, [d.key]: s[d.key] === name ? null : name }))
                }
              />
            ))}
          </div>
        </div>

        {/* Merged pairs table */}
        <div className="mt-8 border-t pt-6">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <div>
              <h4 className="font-semibold text-base">รายละเอียดคู่ PM → Claim</h4>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                <span>เรียงห่างน้อย→มาก · รวม <b>{tablePairs.length.toLocaleString()}</b> คู่</span>
                {bucketSel.length > 0 && (
                  <button
                    onClick={() => onBucketSel([])}
                    className="text-[11px] px-2 py-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20"
                  >
                    ช่วง {bucketSel.join(", ")} วัน ✕
                  </button>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="ค้นหารหัสป้าย / แผนก / Media Type / อาการ / เลขตั๋ว"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-80"
              />
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
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
                  <TableHead>ตั๋ว PM</TableHead>
                  <TableHead>วัน PM</TableHead>
                  <TableHead>ตั๋ว Claim</TableHead>
                  <TableHead>วัน Claim</TableHead>
                  <TableHead className="text-right">ห่าง (วัน)</TableHead>
                  <TableHead>หมวดอาการ</TableHead>
                  <TableHead>อาการ</TableHead>
                  <TableHead>อุปกรณ์</TableHead>
                  <TableHead>วิธีแก้ (หมวด)</TableHead>
                  <TableHead>วิธีแก้</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                      ไม่พบข้อมูลตามเงื่อนไข
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((p, i) => (
                    <TableRow key={start + i} className={p.days <= 7 ? "bg-red-50 dark:bg-red-950/30" : ""}>
                      <TableCell className="font-mono text-xs">{p.assetCode}</TableCell>
                      <TableCell className="text-xs">{p.mediaType}</TableCell>
                      <TableCell className="text-xs">{p.department}</TableCell>
                      <TableCell className="font-mono text-xs">{p.pmTicket || "—"}</TableCell>
                      <TableCell className="text-xs">{p.pmDate}</TableCell>
                      <TableCell className="font-mono text-xs">{p.claimTicket || "—"}</TableCell>
                      <TableCell className="text-xs">{p.claimDate}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.days <= 7 ? (
                          <Badge tone="danger">{p.days} · Critical</Badge>
                        ) : (
                          p.days
                        )}
                      </TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate" title={p.problemCategory}>{p.problemCategory}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate" title={p.problemDetail}>{p.problemDetail}</TableCell>
                      <TableCell className="text-xs max-w-[160px] truncate" title={p.problemEquipment}>{p.problemEquipment}</TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate" title={p.solutionCategory}>{p.solutionCategory}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate" title={p.solutionDetail}>{p.solutionDetail}</TableCell>
                    </TableRow>
                  ))
                )}
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
  title,
  data,
  selected,
  onSelect,
}: {
  title: string;
  data: { name: string; value: number }[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  if (!data.length) {
    return (
      <div className="text-xs text-muted-foreground text-center py-8 border rounded">
        {title}<br />ไม่มีข้อมูล
      </div>
    );
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
              <span
                className="size-2 rounded-sm shrink-0"
                style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
              />
              <span className="truncate flex-1" title={d.name}>{d.name}</span>
              <span className="tabular-nums text-muted-foreground">{d.value}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}



function ScoreReport({
  scoreRows,
}: {
  scoreRows: { month: string; department: string; score: number | null; pmCount: number; claimCount: number }[];
}) {
  const months = Array.from(new Set(scoreRows.map((r) => r.month))).sort();
  const depts = Array.from(new Set(scoreRows.map((r) => r.department))).sort();
  const lineData = months.map((m) => {
    const row: Record<string, number | string | null> = { month: m };
    for (const d of depts) {
      const r = scoreRows.find((s) => s.month === m && s.department === d);
      row[d] = r && r.score !== null ? r.score : null;
    }
    return row;
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>PM Score รายเดือน</CardTitle>
        <div className="text-sm text-muted-foreground mt-2 space-y-1">
          <p><strong>นิยาม:</strong> วัดคุณภาพการ PM ของแต่ละแผนกต่อเดือน — คะแนนสูง = หลัง PM แล้วป้ายไม่เสีย หรือเสียช้า, คะแนนต่ำ = เสียเร็วหลัง PM</p>
          <p><strong>ขอบเขตข้อมูล:</strong> นับเฉพาะ PM ที่ <code>assetStatus = Pass</code> ในช่วง filter, จับคู่กับ Claim ตัวถัดไปของป้ายเดียวกัน (ไม่จำกัดวันที่ Claim)</p>
          <p><strong>สูตร per PM:</strong></p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>ถ้า PM นั้น <u>ไม่มี Claim ตามมา</u> → 100 คะแนน</li>
            <li>ถ้า PM นั้น <u>มี Claim ตามมา</u> → <code>min(days, 90) / 90 × 100</code> โดย days = จำนวนวันระหว่าง PM ปิดงาน → Claim เปิด (เสียภายใน 1 วัน ≈ 1.1 คะแนน, เสียวันที่ 45 = 50 คะแนน, เสียเกิน 90 วัน = 100 คะแนน)</li>
          </ul>
          <p><strong>Score ของเดือน</strong> = ค่าเฉลี่ยคะแนนของ PM ทุกตัวในเดือนนั้น (ปัดเป็นจำนวนเต็ม)</p>
          <p><strong>เดือนที่ไม่มี PM</strong> → แสดงเป็น "—" (ไม่มีข้อมูล) ไม่นับ 0 และไม่ลากเส้นกราฟ</p>
          <p><strong>เกณฑ์สี:</strong> <Badge tone="success">≥ 70 ดี</Badge> <Badge tone="warning">40–69 เฝ้าระวัง</Badge> <Badge tone="danger">&lt; 40 ต้องแก้ไข</Badge></p>
          <p className="text-amber-600 dark:text-amber-400"><strong>หมายเหตุ:</strong> หากเห็นแผนก <code>(ไม่มีสังกัดแผนก)</code> หมายถึง <b>ป้ายต้นทาง</b> ในตาราง <code>assets</code> ยังไม่ได้ระบุ <code>department</code> — แก้ที่ข้อมูลป้ายเพื่อให้คะแนนถูกจัดเข้าแผนกที่ถูกต้อง</p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-72 mb-4">
          <ResponsiveContainer>
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Legend />
              {depts.map((d, i) => (
                <Line
                  key={d}
                  type="monotone"
                  dataKey={d}
                  stroke={PIE_COLORS[i % PIE_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="max-h-96 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เดือน</TableHead>
                <TableHead>แผนก</TableHead>
                <TableHead className="text-right">#PM (Pass)</TableHead>
                <TableHead className="text-right">#Claim หลัง PM</TableHead>
                <TableHead className="text-right">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scoreRows.map((r, i) => (
                <TableRow key={i} className={r.score === null ? "opacity-50" : ""}>
                  <TableCell>{r.month}</TableCell>
                  <TableCell>{r.department}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.pmCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.claimCount}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.score === null ? (
                      <span className="text-muted-foreground">— ไม่มี PM</span>
                    ) : (
                      <Badge tone={r.score >= 70 ? "success" : r.score >= 40 ? "warning" : "danger"}>
                        {r.score}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

type FreqAggRow = { name: string; pm: number; claim: number; assets: number };

function FrequencyReport({
  rows,
  agg,
}: {
  rows: {
    assetCode: string;
    department: string;
    mediaType: string;
    zone: string;
    pmYear: number;
    pmMonth: number;
    avgGapDays: number | null;
    claimsAfterPM: number;
  }[];
  agg: { byMediaType: FreqAggRow[]; byDepartment: FreqAggRow[]; byZone: FreqAggRow[] };
}) {
  const [filter, setFilter] = useState<string>("all");
  const [mtFilter, setMtFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (filter !== "all" && r.department !== filter) return false;
        if (mtFilter !== "all" && r.mediaType !== mtFilter) return false;
        if (search && !r.assetCode.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [rows, filter, mtFilter, search],
  );
  const depts = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department))).filter(Boolean).sort(),
    [rows],
  );
  const mts = useMemo(
    () => Array.from(new Set(rows.map((r) => r.mediaType))).filter(Boolean).sort(),
    [rows],
  );
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>ความถี่ของการ PM</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              ป้ายไหนทำ PM กี่ครั้งต่อปี/เดือน · ห่างกันเฉลี่ยกี่วัน (นับจาก PM ครั้งก่อนหน้า) · มี Claim ตามมาภายหลังกี่ครั้ง · กรองตาม filter ด้านบน
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Input
              placeholder="ค้นหารหัสป้าย"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48"
            />
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="แผนก" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกแผนก</SelectItem>
                {depts.map((d) => (<SelectItem key={d} value={d}>{d}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={mtFilter} onValueChange={setMtFilter}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Media Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุก Media Type</SelectItem>
                {mts.map((d) => (<SelectItem key={d} value={d}>{d}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Multi-dimension charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <FreqAggBar title="Top 15 ตาม Media Type" data={agg.byMediaType} />
          <FreqAggBar title="แยกตามแผนก" data={agg.byDepartment} />
          <FreqAggDonut title="สัดส่วน PM ตาม Media Type (Top 8)" data={agg.byMediaType.slice(0, 8)} />
        </div>

        <div className="max-h-96 overflow-auto border rounded">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>รหัสป้าย</TableHead>
                <TableHead>Media Type</TableHead>
                <TableHead>แผนก</TableHead>
                <TableHead>พื้นที่</TableHead>
                <TableHead className="text-right" title="จำนวนครั้งที่ทำ PM (Pass) ภายในปีนี้">#PM ปีนี้ (ครั้ง)</TableHead>
                <TableHead className="text-right" title="จำนวนครั้งที่ทำ PM (Pass) ภายในเดือนปัจจุบัน">#PM เดือนนี้ (ครั้ง)</TableHead>
                <TableHead className="text-right" title="ค่าเฉลี่ยจำนวนวันระหว่าง PM แต่ละครั้ง (นับจากวันที่ PM Pass ครั้งก่อนหน้าถึงครั้งถัดไป)">เฉลี่ยห่าง (วัน/ครั้ง)</TableHead>
                <TableHead className="text-right" title="จำนวน Claim ที่เปิดหลัง PM Pass (นับเฉพาะ Claim ที่เกิดหลัง PM ในช่วง filter)">Claim หลัง PM (ครั้ง)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.assetCode}>
                  <TableCell className="font-mono text-xs">{r.assetCode}</TableCell>
                  <TableCell className="text-xs">{r.mediaType}</TableCell>
                  <TableCell className="text-xs">{r.department}</TableCell>
                  <TableCell className="text-xs">{r.zone || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.pmYear}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.pmMonth}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.avgGapDays ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.claimsAfterPM > 0 ? (
                      <Badge tone={r.claimsAfterPM >= 3 ? "danger" : "warning"}>{r.claimsAfterPM}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function FreqAggBar({ title, data }: { title: string; data: FreqAggRow[] }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs font-semibold mb-2">{title}</div>
      <div className="h-64">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis type="number" />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="pm" name="PM" fill="oklch(0.7 0.14 160)" />
            <Bar dataKey="claim" name="Claim หลัง PM" fill="oklch(0.6 0.2 25)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function FreqAggDonut({ title, data }: { title: string; data: FreqAggRow[] }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs font-semibold mb-2">{title}</div>
      <div className="h-64">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="pm" nameKey="name" innerRadius={40} outerRadius={80} paddingAngle={2}>
              {data.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
