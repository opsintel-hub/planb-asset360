import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Users,
  CalendarDays,
  Route as RouteIcon,
  Play,
  MapPin,
  AlertTriangle,
  Loader2,
  Navigation,
  RefreshCw,
  Clock,
  Warehouse,
  Crosshair,
  Save,
  Download,
  Trash2,
  FolderOpen,
} from "lucide-react";
import { PageHeader } from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  listSavedLocations,
  listSavedRoutes,
  upsertSavedRoute,
  deleteSavedRoute,
  type SavedRoute,
} from "@/lib/map-store.functions";
import { listAssetsForMap, type MapAsset } from "@/lib/map.functions";
import { PROJECT_TO_DEPARTMENTS, projectForDepartment } from "@/lib/project-department-map";
import {
  REGION_LABELS,
  REGION_ORDER,
  provinceForPoint,
  provincesInRegions,
  regionForProvince,
  type RegionKey,
} from "@/lib/thai-regions";
import {
  balancedKMeans,
  estimateTourMeters,
  haversineM,
  splitIntoDays,
  CLUSTER_COLORS,
  type PlanPoint,
} from "@/lib/route-planner";
import { computeDayRoute, fmtDuration, fmtKm, type DayRoute } from "@/lib/route-osrm";
import { googleMapsDirectionsUrl, type LatLng } from "@/lib/osrm";
import {
  buildPlanCsv,
  decodePlan,
  downloadCsv,
  downloadDayGpx,
  downloadDayKml,
  encodePlan,
  type CsvDaySource,
  type SavedPlanPayload,
} from "@/lib/route-plan-export";
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

const DEFAULT_MINUTES_PER_ASSET = 5;
const DEFAULT_SPEED_KMH = 22;
const DEFAULT_DAILY_HOURS = 8;
/** Hard cap on stops routed per day (keeps the free OSRM demo happy). */
const MAX_ROUTE_STOPS = 200;

type Depot = { lat: number; lng: number; name: string };
type StartMode = "centroid" | "saved" | "pin";
type EndMode = "roundtrip" | "last" | "custom";


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
  const [fRegions, setFRegions] = useState<RegionKey[]>([]);
  const [fProvinces, setFProvinces] = useState<string[]>([]);
  const [lockProvince, setLockProvince] = useState(false);
  const [inspectors, setInspectors] = useState(5);
  const [days, setDays] = useState(3);
  const [emergency, setEmergency] = useState(false);
  const [absent, setAbsent] = useState(1);
  const [plan, setPlan] = useState<InspectorPlan[] | null>(null);
  const [selected, setSelected] = useState<{ i: number; d: number } | null>(null);
  const [routes, setRoutes] = useState<Record<string, DayRoute>>({});
  const [routingKey, setRoutingKey] = useState<string | null>(null);
  const [planNonce, setPlanNonce] = useState(0);
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const mapRef = useRef<AssetMapHandle | null>(null);

  // ---- depot (start / end of each day) ----
  const [startMode, setStartMode] = useState<StartMode>("centroid");
  const [startPoint, setStartPoint] = useState<Depot | null>(null);
  const [endMode, setEndMode] = useState<EndMode>("roundtrip");
  const [endPoint, setEndPoint] = useState<Depot | null>(null);
  const [pinTarget, setPinTarget] = useState<"start" | "end" | null>(null);

  // ---- work-time model ----
  const [minutesPerAsset, setMinutesPerAsset] = useState(DEFAULT_MINUTES_PER_ASSET);
  const [speedKmh, setSpeedKmh] = useState(DEFAULT_SPEED_KMH);
  const [dailyHours, setDailyHours] = useState(DEFAULT_DAILY_HOURS);
  const [mediaMinutes, setMediaMinutes] = useState<Record<string, number>>({});

  const savedFn = useServerFn(listSavedLocations);
  const { data: savedLocations } = useQuery({
    queryKey: ["map-saved-locations"],
    queryFn: () => savedFn({}),
    staleTime: 5 * 60_000,
  });
  const savedList = useMemo(() => savedLocations?.rows ?? [], [savedLocations]);

  /** Service minutes for one asset — per-media override wins over the default. */
  function minutesFor(p: { mediaType: string | null }) {
    const m = p.mediaType ? mediaMinutes[p.mediaType] : undefined;
    return m && m > 0 ? m : minutesPerAsset;
  }
  function serviceHours(pts: Array<{ mediaType: string | null }>) {
    return pts.reduce((s, p) => s + minutesFor(p), 0) / 60;
  }




  // Province resolved offline from coordinates — zero credits.
  const geoAssets = useMemo(
    () =>
      allAssets.map((a) => {
        const province = provinceForPoint(a.lat, a.lng, a.district ?? null);
        return { ...a, province, region: regionForProvince(province) };
      }),
    [allAssets],
  );

  const mediaOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of allAssets) if (a.media_type) s.add(a.media_type);
    return Array.from(s).sort();
  }, [allAssets]);
  const projectOptions = useMemo(() => Object.keys(PROJECT_TO_DEPARTMENTS).sort(), []);
  const regionOptions = useMemo(() => REGION_ORDER.map((r) => REGION_LABELS[r]), []);
  // Province list is locked to the chosen regions and to provinces that have assets.
  const provinceOptions = useMemo(() => {
    const withAssets = new Set(geoAssets.map((a) => a.province));
    return provincesInRegions(fRegions).filter((p) => withAssets.has(p));
  }, [geoAssets, fRegions]);

  const filtered = useMemo(() => {
    const projSet = new Set(fProjects);
    const medSet = new Set(fMedias);
    const regSet = new Set(fRegions);
    const provSet = new Set(fProvinces.filter((p) => provinceOptions.includes(p)));
    return geoAssets.filter((a) => {
      if (projSet.size) {
        const p = projectForDepartment(a.department);
        if (!p || !projSet.has(p)) return false;
      }
      if (medSet.size && !(a.media_type && medSet.has(a.media_type))) return false;
      if (regSet.size && !(a.region && regSet.has(a.region))) return false;
      if (provSet.size && !provSet.has(a.province)) return false;
      return true;
    });
  }, [geoAssets, fProjects, fMedias, fRegions, fProvinces, provinceOptions]);

  const activeInspectors = Math.max(1, inspectors - (emergency ? absent : 0));

  function run() {
    const points: PlanPoint[] = filtered.map((a) => ({
      id: a.id,
      code: a.old_code ?? a.id,
      name: a.name,
      department: a.department,
      mediaType: a.media_type,
      province: a.province,
      lat: a.lat,
      lng: a.lng,
    }));

    // Long-haul trips are the default: clustering may cross provinces freely.
    // "lockProvince" instead allocates staff per province so no zone straddles a border.
    let clusters = [] as ReturnType<typeof balancedKMeans>;
    if (lockProvince) {
      const groups = new Map<string, PlanPoint[]>();
      for (const p of points) {
        const key = p.province ?? "-";
        const arr = groups.get(key);
        if (arr) arr.push(p);
        else groups.set(key, [p]);
      }
      const total = points.length || 1;
      const entries = Array.from(groups.values()).sort((a, b) => b.length - a.length);
      let left = activeInspectors;
      entries.forEach((g, i) => {
        const remainingGroups = entries.length - i;
        const want = Math.round((g.length / total) * activeInspectors) || 1;
        const k = Math.max(1, Math.min(want, left - (remainingGroups - 1)));
        left -= k;
        clusters.push(...balancedKMeans(g, Math.max(1, k)));
      });
      clusters = clusters.map((c, i) => ({ ...c, index: i }));
    } else {
      clusters = balancedKMeans(points, activeInspectors);
    }

    const result: InspectorPlan[] = clusters.map((c) => {
      const dayBatches = splitIntoDays(c.points, days);
      return {
        index: c.index,
        color: CLUSTER_COLORS[c.index % CLUSTER_COLORS.length],
        center: c.center,
        points: c.points,
        days: dayBatches.map((pts, di) => {
          const startAt = startMode === "centroid" ? c.center : startPoint ?? c.center;
          let meters = estimateTourMeters(pts, startAt);
          if (endMode === "roundtrip" && pts.length) {
            meters += haversineM(pts[pts.length - 1], startAt);
          } else if (endMode === "custom" && endPoint && pts.length) {
            meters += haversineM(pts[pts.length - 1], endPoint);
          }
          const hours = serviceHours(pts) + meters / 1000 / Math.max(1, speedKmh);
          return { day: di + 1, points: pts, meters, hours };
        }),
      };
    });
    setPlan(result);
    setSelected(null);
    setRoutes({});
    setFocus(null);
    setPlanNonce((n) => n + 1);
  }

  function provincesOf(pts: PlanPoint[]) {
    const s = new Set<string>();
    for (const p of pts) if (p.province) s.add(p.province);
    return Array.from(s);
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

  /** Media types actually present in the filtered scope — keeps overrides short. */
  const activeMediaTypes = useMemo(() => {
    const s = new Set<string>();
    for (const a of filtered) if (a.media_type) s.add(a.media_type);
    return Array.from(s).sort();
  }, [filtered]);

  const maxHours = plan
    ? Math.max(0, ...plan.flatMap((p) => p.days.map((d) => d.hours)))
    : 0;



  // ---------- Phase 3: real road routing (OSRM /trip + /route) ----------
  /** Start/end of a given inspector-day, honouring the depot settings. */
  function startFor(i: number): Depot {
    const c = plan?.[i]?.center ?? { lat: 0, lng: 0 };
    if (startMode === "centroid" || !startPoint)
      return { ...c, name: `ศูนย์กลางโซน คนที่ ${i + 1}` };
    return startPoint;
  }
  function endFor(i: number): Depot | null {
    if (endMode === "last") return null;
    if (endMode === "custom") return endPoint ?? startFor(i);
    return startFor(i);
  }

  // Depot + time settings are part of the cache key so changing them recomputes.
  const depotSig = `${startMode}:${startPoint?.lat ?? ""},${startPoint?.lng ?? ""}:${endMode}:${endPoint?.lat ?? ""},${endPoint?.lng ?? ""}`;
  const routeKey =
    plan && selected && selected.d > 0
      ? `${planNonce}:${selected.i}:${selected.d}:${depotSig}`
      : null;
  const activeRoute = routeKey ? routes[routeKey] ?? null : null;

  const selectedDayCount =
    plan && selected && selected.d > 0
      ? plan[selected.i]?.days[selected.d - 1]?.points.length ?? 0
      : 0;
  const overRouteCap = selectedDayCount > MAX_ROUTE_STOPS;

  async function computeRoute(force = false) {
    if (!plan || !selected || selected.d === 0 || !routeKey) return;
    if (!force && routes[routeKey]) return;
    const insp = plan[selected.i];
    const day = insp?.days[selected.d - 1];
    if (!insp || !day || day.points.length === 0) return;
    setRoutingKey(routeKey);
    try {
      // Cap requests to the public OSRM server: route the first MAX_ROUTE_STOPS
      // stops of the day so a huge day never floods it.
      const pts = day.points.slice(0, MAX_ROUTE_STOPS);
      const r = await computeDayRoute(pts, startFor(selected.i), endFor(selected.i));
      setRoutes((prev) => ({ ...prev, [routeKey]: r }));
    } finally {
      setRoutingKey((k) => (k === routeKey ? null : k));
    }
  }

  // Auto-compute once per selected day; results are cached so re-selecting is free.
  useEffect(() => {
    if (!routeKey || routes[routeKey] || routingKey) return;

    const t = setTimeout(() => void computeRoute(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, routingKey]);

  const roadPolyline: LatLng[] | null =
    activeRoute && activeRoute.geometry.length > 1 ? activeRoute.geometry : null;

  const onSiteHours = activeRoute ? serviceHours(activeRoute.stops.map((s) => s.point)) : 0;

  function copyGoogleUrl() {
    if (!activeRoute || !plan || !selected) return;
    const s0 = startFor(selected.i);
    const e0 = endFor(selected.i);
    const pts: LatLng[] = [
      [s0.lat, s0.lng],
      ...activeRoute.stops.slice(0, 9).map((s) => [s.point.lat, s.point.lng] as LatLng),
    ];
    if (e0) pts.push([e0.lat, e0.lng]);
    const url = googleMapsDirectionsUrl(pts);
    if (url) void navigator.clipboard.writeText(url);
  }


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
              <MultiSelect
                label="ภูมิภาค"
                options={regionOptions}
                value={fRegions.map((r) => REGION_LABELS[r])}
                onChange={(labels) => {
                  const keys = REGION_ORDER.filter((r) => labels.includes(REGION_LABELS[r]));
                  setFRegions(keys);
                  // keep provinces consistent with the chosen regions
                  const allowed = new Set(provincesInRegions(keys));
                  setFProvinces((prev) => prev.filter((p) => allowed.has(p)));
                }}
              />
              <MultiSelect
                label="จังหวัด"
                options={provinceOptions}
                value={fProvinces}
                onChange={setFProvinces}
              />
            </div>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={lockProvince}
                onChange={(e) => setLockProvince(e.target.checked)}
              />
              <span>
                <b>ไม่ให้โซนข้ามจังหวัด</b> — ปิดไว้ (ค่าเริ่มต้น) ระบบจะจัดทริปยาวข้ามจังหวัดได้
                เช่น ตะวันออก → อีสานล่าง → อีสานบน → กลับ กทม.
              </span>
            </label>
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
              ค่าเริ่มต้น {minutesPerAsset} นาที/ป้าย · ความเร็วเฉลี่ย {speedKmh} กม./ชม. ·
              เพดาน {dailyHours} ชม./วัน
            </div>
            <button
              onClick={run}
              disabled={filtered.length === 0}
              className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-90 transition"
            >
              <Play className="size-4" /> Run Routing Plan
            </button>
          </div>

          {/* ---------- Depot: start / end of each day ---------- */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Warehouse className="size-3.5" /> จุดเริ่มต้น / จุดสิ้นสุดของแต่ละวัน
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium">ออกเดินทางจาก</div>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    ["centroid", "ศูนย์กลางโซน"],
                    ["saved", "คลัง/ที่บันทึกไว้"],
                    ["pin", "ปักหมุดบนแผนที่"],
                  ] as Array<[StartMode, string]>
                ).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => {
                      setStartMode(m);
                      setPinTarget(m === "pin" ? "start" : null);
                    }}
                    className={cn(
                      "h-8 rounded-lg border text-[11px] px-1 hover:bg-accent transition",
                      startMode === m && "bg-accent border-primary font-medium",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {startMode === "saved" && (
                <select
                  value={startPoint?.name ?? ""}
                  onChange={(e) => {
                    const loc = savedList.find((l) => l.name === e.target.value);
                    setStartPoint(loc ? { lat: loc.lat, lng: loc.lng, name: loc.name } : null);
                  }}
                  className="h-9 w-full rounded-lg border bg-background px-2 text-xs"
                >
                  <option value="">— เลือกสถานที่ที่บันทึกไว้ —</option>
                  {savedList.map((l) => (
                    <option key={l.id} value={l.name}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
              {startMode === "pin" && (
                <button
                  onClick={() => setPinTarget(pinTarget === "start" ? null : "start")}
                  className={cn(
                    "h-8 w-full rounded-lg border text-xs inline-flex items-center justify-center gap-1.5 hover:bg-accent",
                    pinTarget === "start" && "bg-accent border-primary",
                  )}
                >
                  <Crosshair className="size-3.5" />
                  {pinTarget === "start" ? "คลิกบนแผนที่เพื่อวางจุดเริ่มต้น…" : "ปักหมุดใหม่"}
                </button>
              )}
              {startMode !== "centroid" && startPoint && (
                <div className="text-[11px] text-muted-foreground truncate">
                  {startPoint.name} · {startPoint.lat.toFixed(5)}, {startPoint.lng.toFixed(5)}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium">สิ้นสุดวันที่</div>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    ["roundtrip", "กลับจุดเริ่มต้น"],
                    ["last", "จบที่ป้ายสุดท้าย"],
                    ["custom", "จุดสิ้นสุดอื่น"],
                  ] as Array<[EndMode, string]>
                ).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => {
                      setEndMode(m);
                      setPinTarget(null);
                    }}
                    className={cn(
                      "h-8 rounded-lg border text-[11px] px-1 hover:bg-accent transition",
                      endMode === m && "bg-accent border-primary font-medium",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {endMode === "custom" && (
                <>
                  <select
                    value={endPoint?.name ?? ""}
                    onChange={(e) => {
                      const loc = savedList.find((l) => l.name === e.target.value);
                      setEndPoint(loc ? { lat: loc.lat, lng: loc.lng, name: loc.name } : null);
                    }}
                    className="h-9 w-full rounded-lg border bg-background px-2 text-xs"
                  >
                    <option value="">— เลือกสถานที่ที่บันทึกไว้ —</option>
                    {savedList.map((l) => (
                      <option key={l.id} value={l.name}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setPinTarget(pinTarget === "end" ? null : "end")}
                    className={cn(
                      "h-8 w-full rounded-lg border text-xs inline-flex items-center justify-center gap-1.5 hover:bg-accent",
                      pinTarget === "end" && "bg-accent border-primary",
                    )}
                  >
                    <Crosshair className="size-3.5" />
                    {pinTarget === "end" ? "คลิกบนแผนที่เพื่อวางจุดสิ้นสุด…" : "หรือปักหมุดบนแผนที่"}
                  </button>
                  {endPoint && (
                    <div className="text-[11px] text-muted-foreground truncate">
                      {endPoint.name} · {endPoint.lat.toFixed(5)}, {endPoint.lng.toFixed(5)}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              เปลี่ยนค่าแล้วระบบจะคำนวณเส้นทางของวันที่เลือกใหม่ให้อัตโนมัติ (ไม่ใช้เครดิต AI)
            </div>
          </div>

          {/* ---------- Work-time model ---------- */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Clock className="size-3.5" /> เวลาทำงานต่อป้าย
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>เวลาเฉลี่ย/ป้าย (นาที)</span>
              <input
                type="number"
                min={1}
                max={480}
                value={minutesPerAsset}
                onChange={(e) => setMinutesPerAsset(Math.max(1, Number(e.target.value) || 1))}
                className="h-9 w-20 rounded-lg border bg-background px-2 text-right tabular-nums"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>ความเร็วเฉลี่ย (กม./ชม.)</span>
              <input
                type="number"
                min={5}
                max={120}
                value={speedKmh}
                onChange={(e) => setSpeedKmh(Math.max(5, Number(e.target.value) || 5))}
                className="h-9 w-20 rounded-lg border bg-background px-2 text-right tabular-nums"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>เพดานชั่วโมงงาน/วัน</span>
              <input
                type="number"
                min={1}
                max={24}
                value={dailyHours}
                onChange={(e) => setDailyHours(Math.max(1, Number(e.target.value) || 1))}
                className="h-9 w-20 rounded-lg border bg-background px-2 text-right tabular-nums"
              />
            </label>
            {activeMediaTypes.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium">
                  ระบุเวลาแยกตามประเภทสื่อ (ว่าง = ใช้ค่าเฉลี่ย)
                </div>
                <div className="max-h-40 overflow-auto space-y-1 pr-1">
                  {activeMediaTypes.map((m) => (
                    <label key={m} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">{m}</span>
                      <input
                        type="number"
                        min={0}
                        max={480}
                        placeholder={String(minutesPerAsset)}
                        value={mediaMinutes[m] ?? ""}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setMediaMinutes((prev) => {
                            const next = { ...prev };
                            if (!e.target.value || !Number.isFinite(v) || v <= 0) delete next[m];
                            else next[m] = v;
                            return next;
                          });
                        }}
                        className="h-8 w-16 rounded-lg border bg-background px-2 text-right tabular-nums"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">
              กด “Run Routing Plan” อีกครั้งเพื่อให้ค่าเวลาใหม่มีผลกับการแบ่งงานต่อวัน
            </div>
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
                  maxHours > dailyHours ? "text-destructive font-semibold" : "text-muted-foreground",
                )}
              >
                ชั่วโมงงานสูงสุด/วัน: {maxHours.toFixed(1)} ชม.
                {maxHours > dailyHours &&
                  ` (เกิน ${dailyHours} ชม. — พิจารณาเพิ่มคนหรือขยายวัน)`}
              </div>
              <div className="text-xs text-muted-foreground">
                วันที่เกินเพดาน:{" "}
                <b className="tabular-nums">
                  {plan.reduce(
                    (n, p) => n + p.days.filter((d) => d.hours > dailyHours).length,
                    0,
                  )}
                </b>{" "}
                / {plan.length * days} วัน-คน
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
                  roadPolyline={roadPolyline}
                  origin={
                    startMode !== "centroid" && startPoint
                      ? startPoint
                      : plan && selected
                        ? {
                            lat: plan[selected.i]?.center.lat ?? 0,
                            lng: plan[selected.i]?.center.lng ?? 0,
                            name: `จุดเริ่มต้น คนที่ ${selected.i + 1}`,
                          }
                        : null
                  }
                  originPickMode={pinTarget !== null}
                  onOriginPick={(lat, lng) => {
                    if (pinTarget === "start")
                      setStartPoint({ lat, lng, name: "จุดเริ่มต้น (ปักหมุด)" });
                    else if (pinTarget === "end")
                      setEndPoint({ lat, lng, name: "จุดสิ้นสุด (ปักหมุด)" });
                    setPinTarget(null);
                  }}
                  focusId={focus?.id ?? null}
                  focusNonce={focus?.nonce ?? 0}

                />
              </Suspense>
            </ClientOnly>
          </div>

          {/* ---------- Phase 3: ordered stops with real distance/time ---------- */}
          {plan && selected && selected.d > 0 && (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b text-sm font-semibold flex flex-wrap items-center gap-2">
                <Navigation className="size-4 text-primary" />
                เส้นทางจริง — คนที่ {selected.i + 1} · วันที่ {selected.d}
                {routingKey === routeKey ? (
                  <span className="text-xs font-normal text-muted-foreground inline-flex items-center gap-1">
                    <Loader2 className="size-3.5 animate-spin" /> กำลังคำนวณเส้นทางบนถนน…
                  </span>
                ) : activeRoute ? (
                  <span
                    className={cn(
                      "text-xs font-normal tabular-nums",
                      activeRoute.totalSeconds / 3600 + onSiteHours > dailyHours
                        ? "text-destructive font-medium"
                        : "text-muted-foreground",
                    )}
                  >
                    {activeRoute.stops.length} จุด · {fmtKm(activeRoute.totalMeters)} ·
                    ขับ {fmtDuration(activeRoute.totalSeconds)} · เวลาตรวจ{" "}
                    {onSiteHours.toFixed(1)} ชม. · รวม{" "}
                    {(activeRoute.totalSeconds / 3600 + onSiteHours).toFixed(1)}/{dailyHours} ชม.
                    {activeRoute.returnMeters > 0 &&
                      ` · ขากลับ ${fmtKm(activeRoute.returnMeters)}`}
                    {activeRoute.approximate && " · (ประมาณการ)"}
                  </span>
                ) : null}
                {overRouteCap && (
                  <span className="text-xs font-normal text-warning">
                    วันนี้มี {selectedDayCount.toLocaleString()} ป้าย — คำนวณเส้นทางจริงให้{" "}
                    {MAX_ROUTE_STOPS} จุดแรก (เพิ่มพนักงานหรือขยายวันเพื่อให้ครบ)
                  </span>
                )}

                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => void computeRoute(true)}
                    disabled={routingKey === routeKey}
                    className="text-xs inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-accent disabled:opacity-50"
                  >
                    <RefreshCw className="size-3.5" /> คำนวณใหม่
                  </button>
                  <button
                    onClick={copyGoogleUrl}
                    disabled={!activeRoute}
                    className="text-xs rounded-lg border px-2 py-1 hover:bg-accent disabled:opacity-50"
                  >
                    Copy Google Maps URL
                  </button>
                </div>
              </div>
              {activeRoute && (
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                      <tr className="text-left text-muted-foreground">
                        <th className="px-3 py-2 w-10">#</th>
                        <th className="px-3 py-2">รหัสป้าย</th>
                        <th className="px-3 py-2">Media</th>
                        <th className="px-3 py-2 text-right">ระยะจากจุดก่อน</th>
                        <th className="px-3 py-2 text-right">เวลาขับ</th>
                        <th className="px-3 py-2 text-right">เวลาตรวจ</th>
                        <th className="px-3 py-2 text-right">สะสม</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {activeRoute.stops.map((s) => (
                        <tr
                          key={s.point.id}
                          onClick={() => setFocus({ id: s.point.id, nonce: Date.now() })}
                          className="cursor-pointer hover:bg-accent/60"
                        >
                          <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{s.seq}</td>
                          <td className="px-3 py-1.5 font-medium">
                            {s.point.code}
                            {s.point.name && (
                              <span className="ml-1 text-muted-foreground font-normal">
                                {s.point.name}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {s.point.mediaType ?? "-"}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {fmtKm(s.legMeters)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {fmtDuration(s.legSeconds)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                            {minutesFor(s.point)} นาที
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                            {fmtKm(s.cumMeters)} · {fmtDuration(s.cumSeconds)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}


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
                    <div className="pl-6 mt-1 flex flex-wrap gap-1">
                      {provincesOf(p.points).slice(0, 6).map((pv) => (
                        <span
                          key={pv}
                          className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {pv}
                        </span>
                      ))}
                      {provincesOf(p.points).length > 6 && (
                        <span className="text-[11px] text-muted-foreground">
                          +{provincesOf(p.points).length - 6}
                        </span>
                      )}
                    </div>
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
