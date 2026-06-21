import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { memo, useMemo, useState } from "react";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Line,
  Bar,
  ComposedChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Microscope, AlertTriangle, Activity, Clock, Repeat, TrendingDown, X, Search,
  Wrench, ChevronRight, AlertCircle,
} from "lucide-react";

import { getRcaPortfolio, getRcaAsset, getRcaMapping } from "@/lib/rca.functions";
import { getPmInsightsFilterOptions } from "@/lib/pm-insights.functions";

export const Route = createFileRoute("/rca")({
  head: () => ({
    meta: [
      { title: "Root Cause Analysis — วิเคราะห์อาการเสียป้าย" },
      { name: "description", content: "วิเคราะห์อาการเสียของป้ายโฆษณาแบบ Portfolio และรายป้าย พร้อม Diagram Mapping Coverage" },
    ],
  }),
  component: RcaPage,
});

const COLORS = [
  "oklch(0.68 0.18 25)",
  "oklch(0.72 0.17 60)",
  "oklch(0.66 0.18 250)",
  "oklch(0.7 0.14 160)",
  "oklch(0.7 0.18 320)",
  "oklch(0.75 0.14 100)",
  "oklch(0.65 0.15 200)",
  "oklch(0.7 0.12 30)",
];

// ─────────────────────── MultiSelect (reused pattern) ───────────────────────
const MultiSelect = memo(function MultiSelect({
  label, options, value, onChange,
}: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const summary = value.length === 0 ? "ทั้งหมด" : value.length <= 3 ? value.join(", ") : `${value.slice(0, 2).join(", ")} +${value.length - 2}`;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full inline-flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent"
      >
        <span className="truncate text-left">
          <span className="text-muted-foreground">{label}:</span>{" "}
          <span className="font-medium">{summary}</span>
          {value.length > 0 && <span className="text-muted-foreground"> ({value.length})</span>}
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
            <div className="sticky bottom-0 pt-2 mt-2 border-t bg-popover">
              <button type="button" className="w-full rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90" onClick={() => setOpen(false)}>
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
  value, onChange, options, placeholder,
}: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  const [focused, setFocused] = useState(false);
  const q = value.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!options.length) return [] as string[];
    if (!q) return options.slice(0, 20);
    const out: string[] = [];
    for (const o of options) {
      if (o.toLowerCase().includes(q)) out.push(o);
      if (out.length >= 20) break;
    }
    return out;
  }, [q, options]);
  return (
    <div className="relative">
      <Input
        placeholder={placeholder ?? "พิมพ์รหัสป้าย..."}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {value && (
        <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => onChange("")}>
          <X className="size-3.5" />
        </button>
      )}
      {focused && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border bg-popover shadow-md p-1 max-h-60 overflow-auto">
          {suggestions.map((c) => (
            <button
              key={c}
              type="button"
              className="w-full text-left px-2 py-1 text-xs rounded hover:bg-accent font-mono"
              onMouseDown={(e) => { e.preventDefault(); onChange(c); setFocused(false); }}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

// ─────────────────────── Filter shape ───────────────────────
type AppliedFilters = {
  zones: string[];
  projects: string[];
  mediaTypes: string[];
  fromDate: string;
  toDate: string;
  assetSearch: string;
};

function RcaPage() {
  const optsFn = useServerFn(getPmInsightsFilterOptions);
  const today = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  const yearStartStr = `${today.getFullYear()}-01-01`;

  const [zones, setZones] = useState<string[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [mediaTypes, setMediaTypes] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState(yearStartStr);
  const [toDate, setToDate] = useState(todayStr);
  const [assetSearchDraft, setAssetSearchDraft] = useState("");
  const [applied, setApplied] = useState<AppliedFilters | null>(null);
  const [tab, setTab] = useState("portfolio");

  const { data: optionsData } = useQuery({
    queryKey: ["rca-filter-options"],
    queryFn: () => optsFn(),
    staleTime: 10 * 60_000,
  });

  const assetMeta = optionsData?.assetMeta ?? [];
  const filterOptionsRaw = optionsData ?? { departments: [], zones: [], projects: [], mediaTypes: [] };

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
    for (const a of assetMeta) { if (!matchesAsset(a, "projects")) continue; if (a.project) s.add(a.project); for (const p of a.projects) s.add(p); }
    return Array.from(s).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMeta, zones, mediaTypes]);
  const availableZones = useMemo(() => {
    if (!assetMeta.length) return filterOptionsRaw.zones;
    const s = new Set<string>();
    for (const a of assetMeta) { if (!matchesAsset(a, "zones")) continue; for (const z of a.zones) s.add(z); }
    return Array.from(s).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMeta, projects, mediaTypes]);
  const availableMediaTypes = useMemo(() => {
    if (!assetMeta.length) return filterOptionsRaw.mediaTypes;
    const s = new Set<string>();
    for (const a of assetMeta) { if (!matchesAsset(a, "mediaTypes")) continue; if (a.mediaType) s.add(a.mediaType); }
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

  const handleApply = () => setApplied({
    zones, projects, mediaTypes, fromDate, toDate, assetSearch: assetSearchDraft.trim(),
  });
  const handleReset = () => {
    setZones([]); setProjects([]); setMediaTypes([]);
    setFromDate(yearStartStr); setToDate(todayStr); setAssetSearchDraft("");
    setApplied(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Microscope className="size-6 text-primary" /> Root Cause Analysis
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          วิเคราะห์อาการเสียของป้ายโฆษณา — ภาพรวม Portfolio, เจาะรายป้าย, และตรวจคุณภาพการ Map Diagram
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">กลุ่มสื่อ (Project)</label>
              <MultiSelect label="กลุ่มสื่อ" options={availableProjects} value={projects} onChange={setProjects} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">พื้นที่ (BKK/UPC)</label>
              <MultiSelect label="พื้นที่" options={availableZones} value={zones} onChange={setZones} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Media Type</label>
              <MultiSelect label="Media Type" options={availableMediaTypes} value={mediaTypes} onChange={setMediaTypes} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                ค้นหารหัสป้าย (Old Code)
                {assetCodeOptions.length > 0 && <span className="ml-1 text-[10px]">({assetCodeOptions.length.toLocaleString()})</span>}
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
                ? "ตั้งค่าตัวกรองแล้วกด “แสดงข้อมูล” — ใช้ร่วมกับ Tab Portfolio และ Diagram Mapping (Tab Per-Asset ใช้รหัสป้ายเป็นหลัก)"
                : "ตัวกรองปัจจุบันถูกใช้กับ Tab Portfolio และ Tab Diagram Mapping"}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleReset}>ล้างค่า</Button>
              <Button size="sm" onClick={handleApply}>{applied === null ? "แสดงข้อมูล" : "อัปเดตข้อมูล"}</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-3 w-full md:w-auto">
          <TabsTrigger value="portfolio"><Activity className="size-4 mr-1" /> ภาพรวม Portfolio</TabsTrigger>
          <TabsTrigger value="asset"><Search className="size-4 mr-1" /> เจาะรายป้าย (Per-Asset)</TabsTrigger>
          <TabsTrigger value="mapping"><Wrench className="size-4 mr-1" /> Diagram Mapping</TabsTrigger>
        </TabsList>

        <TabsContent value="portfolio" className="mt-4">
          <PortfolioTab applied={applied} />
        </TabsContent>
        <TabsContent value="asset" className="mt-4">
          <AssetTab assetCode={applied?.assetSearch ?? ""} />
        </TabsContent>
        <TabsContent value="mapping" className="mt-4">
          <MappingTab applied={applied} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO TAB
// ═══════════════════════════════════════════════════════════════════════
function PortfolioTab({ applied }: { applied: AppliedFilters | null }) {
  const fn = useServerFn(getRcaPortfolio);
  const { data, isLoading } = useQuery({
    queryKey: ["rca-portfolio", applied],
    queryFn: () => fn({
      data: {
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

  if (applied === null) {
    return (
      <Card><CardContent className="py-16 text-center text-muted-foreground space-y-2">
        <Activity className="size-10 mx-auto opacity-40" />
        <p className="text-sm">ตั้งค่าตัวกรองแล้วกด “แสดงข้อมูล”</p>
      </CardContent></Card>
    );
  }
  if (isLoading || !data) {
    return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-24" />)}</div>;
  }

  const matrixGrid = (() => {
    // Build top-N problems × top-N solutions matrix
    const problemTotals = new Map<string, number>();
    const solutionTotals = new Map<string, number>();
    for (const m of data.matrix) {
      problemTotals.set(m.problemCat, (problemTotals.get(m.problemCat) ?? 0) + m.count);
      solutionTotals.set(m.solutionCat, (solutionTotals.get(m.solutionCat) ?? 0) + m.count);
    }
    const topProblems = Array.from(problemTotals.entries()).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0]);
    const topSolutions = Array.from(solutionTotals.entries()).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0]);
    const cellMap = new Map<string, number>();
    let max = 0;
    for (const m of data.matrix) {
      const k = `${m.problemCat}|||${m.solutionCat}`;
      cellMap.set(k, m.count);
      if (m.count > max) max = m.count;
    }
    return { topProblems, topSolutions, cellMap, max };
  })();

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard icon={Activity} label="Total Claims" value={data.summary.totalClaims} color="text-rose-500" />
        <SummaryCard icon={AlertTriangle} label="Unique Assets Affected" value={data.summary.uniqueAssets} color="text-amber-500" />
        <SummaryCard icon={Clock} label="Avg Resolve Time (ชม.)" value={data.summary.avgResolveHrs ?? "—"} color="text-violet-500" />
        <SummaryCard icon={Repeat} label="Repeat-Failure Rate (≥3 ครั้ง)" value={`${data.summary.repeatRatePct}%`} color="text-orange-500" />
      </div>

      {/* Pareto charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ParetoCard title="Pareto — Problem Category" data={data.paretoProblem} />
        <ParetoCard title="Pareto — Problem Equipment" data={data.paretoEquipment} />
      </div>

      {/* Heatmap matrix */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingDown className="size-4" /> Problem → Solution Matrix</CardTitle></CardHeader>
        <CardContent>
          {matrixGrid.topProblems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">ไม่มีข้อมูล</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="text-left p-2 bg-muted/50">Problem ↓ / Solution →</th>
                    {matrixGrid.topSolutions.map((s) => (
                      <th key={s} className="p-2 bg-muted/50 text-center max-w-[120px]"><div className="truncate" title={s}>{s}</div></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixGrid.topProblems.map((p) => (
                    <tr key={p}>
                      <td className="p-2 font-medium max-w-[200px] truncate" title={p}>{p}</td>
                      {matrixGrid.topSolutions.map((s) => {
                        const v = matrixGrid.cellMap.get(`${p}|||${s}`) ?? 0;
                        const intensity = matrixGrid.max > 0 ? v / matrixGrid.max : 0;
                        return (
                          <td key={s} className="p-2 text-center" style={{
                            background: v > 0 ? `oklch(0.68 0.18 25 / ${0.15 + intensity * 0.7})` : "transparent",
                            color: intensity > 0.5 ? "white" : "inherit",
                          }}>
                            {v || ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            แสดง Top 8 Problem × Top 8 Solution — สีเข้ม = ใช้คู่ Problem/Solution นี้บ่อย
          </p>
        </CardContent>
      </Card>

      {/* Top offenders */}
      <Card>
        <CardHeader><CardTitle className="text-base">Top 15 ป้ายที่เสียซ้ำมากสุด</CardTitle></CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Old Code</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead className="text-right">Claims</TableHead>
                  <TableHead className="text-right">MTBF (วัน)</TableHead>
                  <TableHead>อาการหลัก</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topOffenders.map((o) => (
                  <TableRow key={o.oldCode}>
                    <TableCell className="font-mono text-xs">{o.oldCode}</TableCell>
                    <TableCell className="text-xs">{o.project || "—"}</TableCell>
                    <TableCell className="text-xs">{o.zone || "—"}</TableCell>
                    <TableCell className="text-right font-semibold">{o.claims}</TableCell>
                    <TableCell className="text-right">{o.mtbfDays ?? "—"}</TableCell>
                    <TableCell className="text-xs truncate max-w-[280px]" title={o.topSymptom}>{o.topSymptom}</TableCell>
                  </TableRow>
                ))}
                {data.topOffenders.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">ไม่มีข้อมูล</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ParetoCard({ title, data }: { title: string; data: { label: string; count: number; cumulativePct: number }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">ไม่มีข้อมูล</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 50, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" angle={-30} textAnchor="end" interval={0} tick={{ fontSize: 10 }} height={70} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
              <Tooltip />
              <Bar yAxisId="left" dataKey="count" fill="oklch(0.68 0.18 25)" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="cumulativePct" stroke="oklch(0.66 0.18 250)" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string | number; color: string }) {
  return (
    <Card>
      <CardContent className="pt-6 pb-4">
        <div className="flex items-center gap-3">
          <Icon className={`size-8 ${color}`} />
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground truncate">{label}</div>
            <div className="text-2xl font-bold tabular-nums">{value}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PER-ASSET TAB
// ═══════════════════════════════════════════════════════════════════════
function AssetTab({ assetCode }: { assetCode: string }) {
  const fn = useServerFn(getRcaAsset);
  const [windowDays, setWindowDays] = useState(14);

  const { data, isLoading } = useQuery({
    queryKey: ["rca-asset", assetCode, windowDays],
    queryFn: () => fn({ data: { oldCode: assetCode.trim(), windowDays } }),
    enabled: assetCode.trim().length > 0,
    staleTime: 60_000,
  });

  const fmtDate = (s: string) => (s ? s.slice(0, 19).replace("T", " ") : "—");
  const fmtNum = (v: number | null) => (typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—");

  return (
    <div className="space-y-6">
      {!assetCode ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground space-y-2">
          <Search className="size-10 mx-auto opacity-40" />
          <p className="text-sm">กรอก “ค้นหารหัสป้าย (Old Code)” ที่ตัวกรองด้านบน แล้วกด “แสดงข้อมูล / อัปเดตข้อมูล”</p>
        </CardContent></Card>
      ) : isLoading || !data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[1,2,3,4].map(i=><Skeleton key={i} className="h-24" />)}</div>
      ) : !data.asset.found ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" /><AlertTitle>ไม่พบป้าย</AlertTitle>
          <AlertDescription>ไม่พบรหัส <code className="font-mono">{assetCode}</code> ในระบบ Asset ที่ Active</AlertDescription>
        </Alert>
      ) : (
        <>
          {/* PM Effectiveness window control */}
          <Card>
            <CardContent className="pt-6 flex items-center gap-4 flex-wrap">
              <label className="text-xs text-muted-foreground">PM Effectiveness window:</label>
              <div className="flex items-center gap-3">
                <Slider min={3} max={60} step={1} value={[windowDays]} onValueChange={(v) => setWindowDays(v[0])} className="w-48" />
                <Badge variant="outline">{windowDays} วัน</Badge>
              </div>
              <p className="text-xs text-muted-foreground">นับว่า PM Pass ครั้งนั้น “ไม่ได้ผล” ถ้าเกิด Claim ภายใน N วัน</p>
            </CardContent>
          </Card>

          {/* Header */}
          <Card>
            <CardContent className="pt-6 grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <Info label="Old Code" value={<span className="font-mono">{data.asset.oldCode}</span>} />
              <Info label="ชื่อป้าย" value={data.asset.name || "—"} />
              <Info label="Project" value={data.asset.department || "—"} />
              <Info label="Zone" value={data.asset.zone || data.asset.area || "—"} />
              <Info label="Media Type" value={data.asset.mediaType || "—"} />
            </CardContent>
          </Card>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard icon={Activity} label="Total Claims" value={data.kpi.totalClaims} color="text-rose-500" />
            <SummaryCard icon={Repeat} label="MTBF (วัน)" value={data.kpi.mtbfDays ?? "—"} color="text-amber-500" />
            <SummaryCard icon={Clock} label="Avg Resolve (ชม.)" value={data.kpi.avgResolveHrs ?? "—"} color="text-violet-500" />
            <SummaryCard icon={TrendingDown} label="Days since last failure" value={data.kpi.daysSinceLast ?? "—"} color="text-emerald-500" />
          </div>

          {/* Repair-time KPIs (days) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SummaryCard icon={Clock} label="เฉลี่ย Response Time (วัน) — แจ้งซ่อม → เริ่มซ่อม" value={data.repairTime.avgResponseDays ?? "—"} color="text-sky-500" />
            <SummaryCard icon={Wrench} label="เฉลี่ย Resolve Time (วัน) — เวลาที่ช่างใช้ซ่อม" value={data.repairTime.avgResolveDays ?? "—"} color="text-violet-500" />
            <SummaryCard icon={Activity} label="เฉลี่ย Total Turnaround (วัน) — รวมเวลาทั้งหมด" value={data.repairTime.avgTotalTurnaroundDays ?? "—"} color="text-rose-500" />
          </div>

          {/* Recurrence alert */}
          {data.recurrences.length > 0 && (
            <Alert>
              <AlertTriangle className="size-4 text-amber-500" />
              <AlertTitle>ตรวจพบอาการซ้ำภายใน 30 วัน — อาจไม่ได้แก้ที่ต้นเหตุ</AlertTitle>
              <AlertDescription>
                <ul className="mt-2 space-y-1 text-xs">
                  {data.recurrences.slice(0, 5).map((r) => (
                    <li key={r.equipment}>
                      <Badge variant="outline" className="mr-2">{r.count}×</Badge>
                      <span className="font-medium">{r.equipment}</span>
                      <span className="text-muted-foreground"> · {r.firstDate} → {r.lastDate}</span>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* PM Effectiveness */}
          <Card>
            <CardHeader><CardTitle className="text-base">PM Effectiveness ของป้ายนี้</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><div className="text-xs text-muted-foreground">PM Pass ทั้งหมด</div><div className="text-xl font-semibold">{data.pmEffective.passCount}</div></div>
                <div><div className="text-xs text-muted-foreground">PM ที่ตามด้วย Claim ใน {data.pmEffective.windowDays} วัน</div><div className="text-xl font-semibold text-rose-500">{data.pmEffective.failedAfterCount}</div></div>
                <div><div className="text-xs text-muted-foreground">Success Rate</div><div className="text-xl font-semibold text-emerald-500">{data.pmEffective.successRate ?? "—"}%</div></div>
              </div>
              {data.pmEffective.fails.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>PM Date</TableHead><TableHead>Claim Date</TableHead><TableHead className="text-right">Days</TableHead><TableHead>Problem</TableHead><TableHead>Equipment</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {data.pmEffective.fails.slice(0, 10).map((f, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">{f.pmDate}</TableCell>
                          <TableCell className="text-xs">{f.claimDate}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{f.days}</TableCell>
                          <TableCell className="text-xs">{f.problem}</TableCell>
                          <TableCell className="text-xs">{f.equipment}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Failure Fingerprint */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <FingerprintCard title="Problem Category" rows={data.fingerprint.problem} />
            <FingerprintCard title="Problem Equipment" rows={data.fingerprint.equipment} />
            <FingerprintCard title="Solution Category" rows={data.fingerprint.solution} />
          </div>

          {/* Timeline */}
          <Card>
            <CardHeader><CardTitle className="text-base">Timeline เหตุการณ์ทั้งหมด</CardTitle></CardHeader>
            <CardContent>
              <Timeline events={data.events} />
            </CardContent>
          </Card>

          {/* Full history table */}
          <Card>
            <CardHeader><CardTitle className="text-base">ประวัติ Claim ทั้งหมด ({data.history.length} รายการ)</CardTitle></CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table className="min-w-[1800px]">
                  <TableHeader><TableRow>
                    <TableHead className="whitespace-nowrap">Create Date</TableHead>
                    <TableHead className="whitespace-nowrap">Update Date</TableHead>
                    <TableHead className="whitespace-nowrap">Inform Position</TableHead>
                    <TableHead className="whitespace-nowrap">Inform Detail</TableHead>
                    <TableHead className="whitespace-nowrap">Problem Category</TableHead>
                    <TableHead className="whitespace-nowrap">Problem Equipment</TableHead>
                    <TableHead className="whitespace-nowrap">Problem Detail</TableHead>
                    <TableHead className="whitespace-nowrap">Solution Category</TableHead>
                    <TableHead className="whitespace-nowrap">Solution Detail</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Response Time (ชม.)</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Resolve Time (ชม.)</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Total Turnaround (ชม.)</TableHead>
                    <TableHead className="whitespace-nowrap">Asset Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.history.slice(0, 200).map((h, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs whitespace-nowrap">{fmtDate(h.createdDate)}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{fmtDate(h.updatedDate)}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate" title={h.informPosition}>{h.informPosition || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[260px] truncate" title={h.informDetail}>{h.informDetail || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{h.problemCategory || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{h.problemEquipment || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[260px] truncate" title={h.problemDetail}>{h.problemDetail || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{h.solutionCategory || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[260px] truncate" title={h.solutionDetail}>{h.solutionDetail || "—"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{fmtNum(h.responseTime)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{fmtNum(h.resolveTime)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{fmtNum(h.totalTurnaroundTime)}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{h.assetStatus || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="font-medium truncate">{value}</div></div>;
}

function FingerprintCard({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={rows} dataKey="count" nameKey="label" innerRadius={40} outerRadius={70} paddingAngle={2}>
              {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <ul className="mt-2 space-y-1 text-xs">
          {rows.slice(0, 5).map((r, i) => (
            <li key={r.label} className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="truncate flex-1" title={r.label}>{r.label}</span>
              <span className="text-muted-foreground tabular-nums">{r.count}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Timeline({ events }: { events: { kind: "PM" | "Monitoring" | "Claim"; date: string; status: string; problem: string; equipment: string }[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground py-6 text-center">ไม่มีเหตุการณ์</p>;
  const colorMap: Record<string, string> = {
    PM: "oklch(0.66 0.18 250)",
    Monitoring: "oklch(0.7 0.14 160)",
    Claim: "oklch(0.68 0.18 25)",
  };
  // group by date for compact display
  const byDate = new Map<string, typeof events>();
  for (const e of events) {
    const d = e.date.slice(0, 10);
    const arr = byDate.get(d) ?? [];
    arr.push(e);
    byDate.set(d, arr);
  }
  const sorted = Array.from(byDate.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
      {sorted.map(([date, evs]) => (
        <div key={date} className="flex items-start gap-3 text-xs">
          <div className="font-mono text-muted-foreground w-24 shrink-0 pt-1">{date}</div>
          <div className="flex flex-wrap gap-1.5 flex-1">
            {evs.map((e, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-white text-[10px]"
                style={{ background: colorMap[e.kind] }}
                title={`${e.kind} · ${e.status}${e.problem ? ` · ${e.problem}` : ""}${e.equipment ? ` · ${e.equipment}` : ""}`}
              >
                {e.kind}{e.status ? ` · ${e.status}` : ""}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAPPING TAB
// ═══════════════════════════════════════════════════════════════════════
function MappingTab({ applied }: { applied: AppliedFilters | null }) {
  const fn = useServerFn(getRcaMapping);
  const { data, isLoading } = useQuery({
    queryKey: ["rca-mapping", applied],
    queryFn: () => fn({
      data: {
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

  if (applied === null) {
    return (
      <Card><CardContent className="py-16 text-center text-muted-foreground space-y-2">
        <Wrench className="size-10 mx-auto opacity-40" />
        <p className="text-sm">ตั้งค่าตัวกรองแล้วกด “แสดงข้อมูล”</p>
      </CardContent></Card>
    );
  }
  if (isLoading || !data) {
    return <div className="grid grid-cols-2 gap-4">{[1,2,3,4].map(i=><Skeleton key={i} className="h-24" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard icon={Activity} label="Total Claims" value={data.total} color="text-blue-500" />
        <SummaryCard icon={AlertTriangle} label="Unmapped" value={data.unmappedCount} color="text-amber-500" />
        <SummaryCard icon={TrendingDown} label="Unmapped %" value={`${data.unmappedPct}%`} color="text-rose-500" />
        <SummaryCard icon={Wrench} label="Mapping Rules" value={data.mappings.length} color="text-violet-500" />
      </div>

      {/* Distribution pie */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Distribution by Diagram Category</CardTitle></CardHeader>
          <CardContent>
            {data.distribution.length === 0 ? <p className="text-sm text-muted-foreground py-8 text-center">ไม่มีข้อมูล</p> : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={data.distribution} dataKey="count" nameKey="label" outerRadius={100} label={(e: { label: string; count: number }) => `${e.label} (${e.count})`}>
                    {data.distribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Coverage per Category</CardTitle></CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Category</TableHead><TableHead className="text-right">Claims</TableHead><TableHead className="text-right">Assets</TableHead><TableHead className="text-right">MTBF</TableHead><TableHead className="text-right">Resolve (ชม.)</TableHead><TableHead>Top Solution</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data.perCategory.map((c) => (
                  <TableRow key={c.category}>
                    <TableCell className="text-xs">
                      <Badge variant={c.category === "_unmapped" ? "destructive" : "secondary"}>{c.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold">{c.totalClaims}</TableCell>
                    <TableCell className="text-right text-xs">{c.uniqueAssets}</TableCell>
                    <TableCell className="text-right text-xs">{c.mtbfDays ?? "—"}</TableCell>
                    <TableCell className="text-right text-xs">{c.avgResolveHrs ?? "—"}</TableCell>
                    <TableCell className="text-xs truncate max-w-[180px]" title={c.topSolution}>{c.topSolution}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Top unmapped phrases */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Top Unmapped Phrases (จาก problem_equipment)</CardTitle>
          <Link to="/settings" className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
            ไปเพิ่ม Keyword ใน Diagram Mappings <ChevronRight className="size-3" />
          </Link>
        </CardHeader>
        <CardContent>
          {data.topUnmapped.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">ทุก claim เข้าหมวดหมด — Coverage 100% 🎉</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {data.topUnmapped.map((p) => (
                <div key={p.phrase} className="flex items-center justify-between gap-2 px-3 py-2 rounded border text-xs">
                  <span className="truncate" title={p.phrase}>{p.phrase}</span>
                  <Badge variant="outline" className="tabular-nums">{p.count}</Badge>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            วลีเหล่านี้ไม่ตรงกับ keyword ใน Diagram Mappings ที่ตั้งไว้ — ลองเพิ่ม keyword ที่หน้า Settings เพื่อเพิ่ม Coverage
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
