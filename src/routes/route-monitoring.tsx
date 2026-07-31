import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Users, CalendarDays, Route as RouteIcon, Play, MapPin, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { listAssetsForMap, type MapAsset } from "@/lib/map.functions";
import { PROJECT_TO_DEPARTMENTS, projectForDepartment } from "@/lib/project-department-map";
import {
  balancedKMeans,
  estimateTourMeters,
  splitIntoDays,
  CLUSTER_COLORS,
  type PlanPoint,
} from "@/lib/route-planner";
import type { AssetMapHandle } from "@/components/asset-map";

const AssetMap = lazy(() => import("@/components/asset-map"));

export const Route = createFileRoute("/route-monitoring")({
  head: () => ({
    meta: [
      { title: "Route Monitoring — Asset History 360" },
      {
        name: "description",
        content:
          "วางแผนเส้นทางตรวจสื่อแบบอัตโนมัติ แบ่งโซนตามจำนวนพนักงาน และกรอบเวลาที่ต้องตรวจให้ครบ",
      },
      { property: "og:title", content: "Route Monitoring — Asset History 360" },
      {
        property: "og:description",
        content: "แบ่งโซนตรวจสื่อด้วย K-Means และวางแผนงานต่อคนต่อวันโดยอัตโนมัติ",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteMonitoringPage,
});

const MINUTES_PER_ASSET = 5;
const AVG_SPEED_KMH = 22;

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
  const text = value.length === 0 ? `${label}: ทั้งหมด` : `${label}: ${value.length}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="h-9 px-3 rounded-lg border bg-card text-xs font-medium hover:bg-accent transition">
          {text}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2 max-h-72 overflow-auto">
        <button
          className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent"
          onClick={() => onChange([])}
        >
          ล้างตัวเลือก
        </button>
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <label
              key={o}
              className="flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() =>
                  onChange(on ? value.filter((v) => v !== o) : [...value, o])
                }
              />
              <span className="truncate">{o}</span>
            </label>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

type DayPlan = { day: number; points: PlanPoint[]; meters: number; hours: number };
type InspectorPlan = {
  index: number;
  color: string;
  center: { lat: number; lng: number };
  points: PlanPoint[];
  days: DayPlan[];
};

function RouteMonitoringPage() {
  const fn = useServerFn(listAssetsForMap);
  const { data, isLoading } = useQuery({
    queryKey: ["map-assets"],
    queryFn: () => fn({}),
    staleTime: 5 * 60_000,
  });
  const allAssets: MapAsset[] = useMemo(() => data?.assets ?? [], [data]);

  const [fProjects, setFProjects] = useState<string[]>([]);
  const [fMedias, setFMedias] = useState<string[]>([]);
  const [inspectors, setInspectors] = useState(5);
  const [days, setDays] = useState(3);
  const [emergency, setEmergency] = useState(false);
  const [absent, setAbsent] = useState(1);
  const [plan, setPlan] = useState<InspectorPlan[] | null>(null);
  const [selected, setSelected] = useState<{ i: number; d: number } | null>(null);
  const mapRef = useRef<AssetMapHandle | null>(null);

  const mediaOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of allAssets) if (a.media_type) s.add(a.media_type);
    return Array.from(s).sort();
  }, [allAssets]);
  const projectOptions = useMemo(() => Object.keys(PROJECT_TO_DEPARTMENTS).sort(), []);

  const filtered = useMemo(() => {
    const projSet = new Set(fProjects);
    const medSet = new Set(fMedias);
    return allAssets.filter((a) => {
      if (projSet.size) {
        const p = projectForDepartment(a.department);
        if (!p || !projSet.has(p)) return false;
      }
      if (medSet.size && !(a.media_type && medSet.has(a.media_type))) return false;
      return true;
    });
  }, [allAssets, fProjects, fMedias]);

  const activeInspectors = Math.max(1, inspectors - (emergency ? absent : 0));

  function run() {
    const points: PlanPoint[] = filtered.map((a) => ({
      id: a.id,
      code: a.old_code ?? a.id,
      name: a.name,
      department: a.department,
      mediaType: a.media_type,
      lat: a.lat,
      lng: a.lng,
    }));
    const clusters = balancedKMeans(points, activeInspectors);
    const result: InspectorPlan[] = clusters.map((c) => {
      const dayBatches = splitIntoDays(c.points, days);
      return {
        index: c.index,
        color: CLUSTER_COLORS[c.index % CLUSTER_COLORS.length],
        center: c.center,
        points: c.points,
        days: dayBatches.map((pts, di) => {
          const meters = estimateTourMeters(pts, c.center);
          const hours =
            (pts.length * MINUTES_PER_ASSET) / 60 + meters / 1000 / AVG_SPEED_KMH;
          return { day: di + 1, points: pts, meters, hours };
        }),
      };
    });
    setPlan(result);
    setSelected(null);
  }

  const shownAssets = useMemo(() => {
    if (!plan || !selected) return filtered;
    const p = plan[selected.i];
    if (!p) return filtered;
    const set = new Set(
      (selected.d === 0 ? p.points : p.days[selected.d - 1]?.points ?? []).map((x) => x.id),
    );
    return filtered.filter((a) => set.has(a.id));
  }, [plan, selected, filtered]);

  const maxHours = plan
    ? Math.max(0, ...plan.flatMap((p) => p.days.map((d) => d.hours)))
    : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Route Monitoring"
        subtitle="วางแผนเส้นทางตรวจสื่อ: กรองป้าย → ระบุจำนวนคนและกรอบเวลา → ระบบแบ่งโซนและงานต่อวันให้อัตโนมัติ"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* ---------- Inputs ---------- */}
        <div className="space-y-3">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              ขอบเขตป้ายที่จะตรวจ
            </div>
            <div className="flex flex-wrap gap-2">
              <MultiSelect label="Project" options={projectOptions} value={fProjects} onChange={setFProjects} />
              <MultiSelect label="Media" options={mediaOptions} value={fMedias} onChange={setFMedias} />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="size-4 text-primary" />
              <span className="font-semibold tabular-nums">{filtered.length.toLocaleString()}</span>
              <span className="text-muted-foreground">ป้ายที่จะนำไปวางแผน</span>
            </div>
            {isLoading && <Skeleton className="h-4 w-32" />}
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              ทรัพยากรและกรอบเวลา
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" /> จำนวนพนักงาน
              </span>
              <input
                type="number"
                min={1}
                max={50}
                value={inspectors}
                onChange={(e) => setInspectors(Math.max(1, Number(e.target.value) || 1))}
                className="h-9 w-20 rounded-lg border bg-background px-2 text-right tabular-nums"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <CalendarDays className="size-4 text-muted-foreground" /> กรอบเวลา (วัน)
              </span>
              <input
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
                className="h-9 w-20 rounded-lg border bg-background px-2 text-right tabular-nums"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={emergency}
                onChange={(e) => setEmergency(e.target.checked)}
              />
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="size-4 text-warning" /> เหตุฉุกเฉิน (มีคนลา)
              </span>
            </label>
            {emergency && (
              <label className="flex items-center justify-between gap-3 text-sm pl-6">
                <span>จำนวนคนลา</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, inspectors - 1)}
                  value={absent}
                  onChange={(e) => setAbsent(Math.max(1, Number(e.target.value) || 1))}
                  className="h-9 w-20 rounded-lg border bg-background px-2 text-right tabular-nums"
                />
              </label>
            )}
            <div className="text-xs text-muted-foreground">
              พนักงานที่ใช้วางแผนจริง: <b className="tabular-nums">{activeInspectors}</b> คน ·
              ประมาณการ {MINUTES_PER_ASSET} นาที/ป้าย · ความเร็วเฉลี่ย {AVG_SPEED_KMH} กม./ชม.
            </div>
            <button
              onClick={run}
              disabled={filtered.length === 0}
              className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-90 transition"
            >
              <Play className="size-4" /> Run Routing Plan
            </button>
          </div>

          {plan && (
            <div className="rounded-xl border bg-card p-4 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                สรุปแผน
              </div>
              <div className="text-sm">
                ป้ายทั้งหมด <b className="tabular-nums">{filtered.length.toLocaleString()}</b> ·
                เฉลี่ย{" "}
                <b className="tabular-nums">
                  {Math.ceil(filtered.length / activeInspectors / days).toLocaleString()}
                </b>{" "}
                ป้าย/คน/วัน
              </div>
              <div
                className={cn(
                  "text-sm",
                  maxHours > 8 ? "text-destructive font-semibold" : "text-muted-foreground",
                )}
              >
                ชั่วโมงงานสูงสุด/วัน: {maxHours.toFixed(1)} ชม.
                {maxHours > 8 && " (เกิน 8 ชม. — พิจารณาเพิ่มคนหรือขยายวัน)"}
              </div>
            </div>
          )}
        </div>

        {/* ---------- Map + result ---------- */}
        <div className="space-y-3">
          <div className="rounded-xl border overflow-hidden bg-card" style={{ height: 460 }}>
            <ClientOnly fallback={<Skeleton className="h-full w-full" />}>
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <AssetMap
                  ref={mapRef}
                  assets={shownAssets}
                  claimedCodes={new Set<string>()}
                  showRadiusRings={false}
                />
              </Suspense>
            </ClientOnly>
          </div>

          {plan && (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b text-sm font-semibold flex items-center gap-2">
                <RouteIcon className="size-4 text-primary" /> แผนงานต่อคน / ต่อวัน
                {selected && (
                  <button
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSelected(null)}
                  >
                    แสดงทุกโซน
                  </button>
                )}
              </div>
              <div className="divide-y">
                {plan.map((p) => (
                  <div key={p.index} className="p-3">
                    <button
                      onClick={() => setSelected({ i: p.index, d: 0 })}
                      className={cn(
                        "w-full flex items-center gap-2 text-sm text-left rounded-lg px-2 py-1.5 hover:bg-accent transition",
                        selected?.i === p.index && selected.d === 0 && "bg-accent",
                      )}
                    >
                      <span
                        className="size-3 rounded-full shrink-0"
                        style={{ background: p.color }}
                      />
                      <span className="font-medium">พนักงานคนที่ {p.index + 1}</span>
                      <span className="ml-auto text-muted-foreground tabular-nums">
                        {p.points.length.toLocaleString()} ป้าย
                      </span>
                    </button>
                    <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-1.5 pl-6">
                      {p.days.map((d) => (
                        <button
                          key={d.day}
                          onClick={() => setSelected({ i: p.index, d: d.day })}
                          className={cn(
                            "text-left rounded-lg border px-2 py-1.5 text-xs hover:bg-accent transition",
                            selected?.i === p.index && selected.d === d.day && "bg-accent border-primary",
                          )}
                        >
                          <div className="font-medium">วันที่ {d.day}</div>
                          <div className="text-muted-foreground tabular-nums">
                            {d.points.length} ป้าย · ~{(d.meters / 1000).toFixed(1)} กม. ·{" "}
                            {d.hours.toFixed(1)} ชม.
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
