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
import { getPmInsights } from "@/lib/pm-insights.functions";
import { BarChart3, Building2, Wrench, Activity, Clock, RefreshCw } from "lucide-react";

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

function PmInsightsPage() {
  const fn = useServerFn(getPmInsights);
  const qc = useQueryClient();
  const today = new Date();
  const default90 = new Date(today.getTime() - 90 * 86400_000);
  const [departments, setDepartments] = useState<string[]>([]);
  const [zones, setZones] = useState<string[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState(default90.toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(today.toISOString().slice(0, 10));

  const filters = { departments, zones, projects, fromDate, toDate };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["pm-insights", filters],
    queryFn: () => fn({ data: filters }),
    staleTime: 5 * 60_000,
  });

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
          disabled={isFetching}
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
              <label className="text-xs text-muted-foreground">Project</label>
              <MultiSelect
                label="Project"
                options={data?.filters.projects ?? []}
                value={projects}
                onChange={setProjects}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">พื้นที่</label>
              <MultiSelect
                label="พื้นที่"
                options={data?.filters.zones ?? []}
                value={zones}
                onChange={setZones}
              />
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
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <KpiCard
              icon={Building2}
              label="จำนวนป้ายทั้งหมด"
              value={data.kpi.assets}
              color="text-blue-500"
              description="นับ distinct asset_old_code จากตาราง assets ทั้งหมด (ไม่ขึ้นกับ filter วันที่)"
            />
            <KpiCard
              icon={Wrench}
              label="จำนวนป้ายที่เปิดตั๋ว PM"
              value={data.kpi.pmDone}
              color="text-green-500"
              description="นับ distinct asset_old_code ที่มี PM ticket (ทุกสถานะ) ภายในช่วงวันที่ filter — รวม PM ที่ยังไม่ Pass และ PM Pass ที่ยังไม่มี Claim ตามมา จึงมากกว่าจำนวนคู่ใน Aging chart"
            />
          </div>

          {/* Monthly PM vs Claim (current year) */}
          <MonthlyChart data={data.monthly} />

          {/* Report 1: Aging chart + donuts */}
          <AgingReport aging={data.aging} pairs={data.pairs} />

          {/* Pair detail table — separate with pagination */}
          <PairsTable pairs={data.pairs} />

          {/* Report 3: Score */}
          <ScoreReport scoreRows={data.scoreRows} />

          {/* Report 4: Frequency */}
          <FrequencyReport rows={data.frequency} />
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

function MonthlyChart({ data }: { data: { month: string; pm: number; claim: number }[] }) {
  const year = new Date().getFullYear();
  return (
    <Card>
      <CardHeader>
        <CardTitle>จำนวนตั๋ว PM และ Claim รายเดือน (ปี {year})</CardTitle>
        <div className="text-sm text-muted-foreground mt-1 space-y-1">
          <p>นับจาก <b>วันที่เปิดตั๋ว (createdDate)</b> ของแต่ละตั๋ว แล้วจัดกลุ่มตามเดือนของปี {year}</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><b>แท่งเขียว (PM)</b> = จำนวนตั๋ว PM ทั้งหมดที่ถูกเปิดในเดือนนั้น (ทุกสถานะ ทั้ง Pass / Fail / In progress)</li>
            <li><b>แท่งแดง (Claim)</b> = จำนวนตั๋ว Claim ทั้งหมดที่ถูกเปิดในเดือนนั้น (ทุกสถานะ ทั้งปิดแล้วและยังค้าง)</li>
          </ul>
          <p>* กราฟนี้ใช้กรองจาก Filter ด้านบน (แผนก / โซน / โปรเจกต์ / ช่วงวันที่) — เดือนที่ยังไม่ถึงจะแสดงเป็นค่าว่าง</p>
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
}: {
  aging: { bucket: string; count: number }[];
  pairs: AgingPair[];
}) {
  const [sel, setSel] = useState<Record<DonutKey, string | null>>({
    problemCategory: null,
    problemDetail: null,
    problemEquipment: null,
    solutionCategory: null,
    solutionDetail: null,
  });

  const early = useMemo(() => pairs.filter((p) => p.days <= 30), [pairs]);
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

  const activeFilters = DONUT_DEFS.filter((d) => sel[d.key]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>รายงาน 1 · PM Effectiveness & Aging</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          จับคู่ PM (assetStatus = Pass) กับ Claim ครั้งถัดไปของป้ายเดียวกัน แล้วนับจำนวน "คู่" ตามช่วงวันที่ห่างกัน
          · รวม <span className="font-semibold text-foreground">{totalPairs}</span> คู่ ·
          แท่ง 1–3, 4–7 วัน = Critical (PM แล้วเสียซ้ำเร็ว) ·
          PM Pass ที่ยังไม่มี Claim ตามมาจะไม่ถูกนับในกราฟนี้ (ดูจำนวนเต็มที่ KPI ด้านบน)
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
              <Bar dataKey="count" fill="oklch(0.66 0.18 250)" radius={[8, 8, 0, 0]}>
                {aging.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={
                      entry.bucket === "1-3" || entry.bucket === "4-7"
                        ? "oklch(0.6 0.2 25)"
                        : "oklch(0.66 0.18 250)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div>
              <h4 className="font-semibold text-sm">
                อาการ/วิธีแก้ที่พบบ่อย (เฉพาะ Claim ภายใน 30 วันหลัง PM)
              </h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                นับจำนวนคู่ PM→Claim ที่ห่างกัน ≤ 30 วัน ({early.length} คู่) · คลิกชิ้นโดนัทเพื่อกรองข้าม chart
              </p>
            </div>
            {activeFilters.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {activeFilters.map((d) => (
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
      </CardContent>
    </Card>
  );
}

function PairsTable({ pairs }: { pairs: AgingPair[] }) {
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pairs;
    return pairs.filter(
      (p) =>
        p.assetCode.toLowerCase().includes(q) ||
        p.department.toLowerCase().includes(q) ||
        p.problemDetail.toLowerCase().includes(q) ||
        p.problemCategory.toLowerCase().includes(q),
    );
  }, [pairs, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>รายละเอียดคู่ PM → Claim (ทั้งหมด)</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              ทุกคู่ที่จับได้จากช่วงวันที่ filter · เรียงห่างน้อย→มาก · รวม {filtered.length.toLocaleString()} คู่
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="ค้นหารหัสป้าย / แผนก / อาการ"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-64"
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
      </CardHeader>
      <CardContent>
        <div className="overflow-auto border rounded">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>รหัสป้าย</TableHead>
                <TableHead>แผนก</TableHead>
                <TableHead>ตั๋ว PM</TableHead>
                <TableHead>วัน PM</TableHead>
                <TableHead>ตั๋ว Claim</TableHead>
                <TableHead>วัน Claim</TableHead>
                <TableHead className="text-right">ห่าง (วัน)</TableHead>
                <TableHead>หมวดอาการ</TableHead>
                <TableHead>อาการ</TableHead>
                <TableHead>วิธีแก้</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    ไม่พบข้อมูล
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((p, i) => (
                  <TableRow key={start + i} className={p.days <= 7 ? "bg-red-50 dark:bg-red-950/30" : ""}>
                    <TableCell className="font-mono text-xs">{p.assetCode}</TableCell>
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
                    <TableCell className="text-xs max-w-[160px] truncate" title={p.problemCategory}>
                      {p.problemCategory}
                    </TableCell>
                    <TableCell className="text-xs max-w-[220px] truncate" title={p.problemDetail}>
                      {p.problemDetail}
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate" title={p.solutionDetail}>
                      {p.solutionDetail}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <div>
            แสดง {filtered.length === 0 ? 0 : start + 1}–{Math.min(start + pageSize, filtered.length)} จาก {filtered.length.toLocaleString()}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(1)}>
              «
            </Button>
            <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
              ก่อนหน้า
            </Button>
            <span className="px-2 tabular-nums">
              หน้า {currentPage} / {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>
              ถัดไป
            </Button>
            <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)}>
              »
            </Button>
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
        <CardTitle>รายงาน 3 · PM Score รายเดือนต่อแผนก</CardTitle>
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

function FrequencyReport({
  rows,
}: {
  rows: {
    assetCode: string;
    department: string;
    pmYear: number;
    pmMonth: number;
    avgGapDays: number | null;
    claimsAfterPM: number;
  }[];
}) {
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (filter !== "all" && r.department !== filter) return false;
        if (search && !r.assetCode.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [rows, filter, search],
  );
  const depts = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department))).filter(Boolean).sort(),
    [rows],
  );
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>รายงาน 4 · ความถี่การ PM รายป้าย</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              ป้ายไหนทำ PM กี่ครั้ง · ค่าเฉลี่ยช่วงห่าง · มี Claim ตามมากี่ครั้ง
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="ค้นหารหัสป้าย"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48"
            />
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="แผนก" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกแผนก</SelectItem>
                {depts.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-96 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>รหัสป้าย</TableHead>
                <TableHead>แผนก</TableHead>
                <TableHead className="text-right">#PM ปีนี้</TableHead>
                <TableHead className="text-right">#PM เดือนนี้</TableHead>
                <TableHead className="text-right">เฉลี่ยห่าง (วัน)</TableHead>
                <TableHead className="text-right">Claim หลัง PM</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.assetCode}>
                  <TableCell className="font-mono text-xs">{r.assetCode}</TableCell>
                  <TableCell>{r.department}</TableCell>
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
