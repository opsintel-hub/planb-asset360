import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/ui-bits";
import {
  MapPin,
  AlertTriangle,
  Layers,
  Search,
  Maximize2,
  Minimize2,
  X,
  Pencil,
  Trash2,
  Download,
  Route as RouteIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { listAssetsForMap, listOpenClaimOldCodes, type MapAsset } from "@/lib/map.functions";
import { PROJECT_TO_DEPARTMENTS, projectForDepartment } from "@/lib/project-department-map";

const AssetMap = lazy(() => import("@/components/asset-map"));

type LatLng = [number, number];

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "Asset Map — Asset History 360" },
      { name: "description", content: "แผนที่ป้ายโฆษณาทั้งหมด กรองตาม Project / Media Type พร้อมสัญลักษณ์เตือนป้ายที่กำลังซ่อม" },
    ],
  }),
  component: MapPage,
});

const RADIUS_PRESETS = [50, 100, 200, 500, 1000];

// Great-circle distance between two lat/lng in meters (Haversine)
function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const la1 = toRad(a[0]);
  const la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Distance from point p to segment [a,b] in meters, using local equirectangular approx.
function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const lat0 = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(lat0);
  const ax = 0;
  const ay = 0;
  const bx = (b[1] - a[1]) * mPerDegLng;
  const by = (b[0] - a[0]) * mPerDegLat;
  const px = (p[1] - a[1]) * mPerDegLng;
  const py = (p[0] - a[0]) * mPerDegLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function distanceToPolyline(p: LatLng, line: LatLng[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversine(p, line[0]);
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const d = distanceToSegment(p, line[i], line[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

function polylineLength(line: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) total += haversine(line[i], line[i + 1]);
  return total;
}

function MapPage() {
  const assetsFn = useServerFn(listAssetsForMap);
  const claimsFn = useServerFn(listOpenClaimOldCodes);

  const { data: assetsData, isLoading: loadingAssets } = useQuery({
    queryKey: ["map", "assets"],
    queryFn: () => assetsFn({}),
    staleTime: 5 * 60_000,
  });
  const { data: claimsData } = useQuery({
    queryKey: ["map", "open-claims"],
    queryFn: () => claimsFn({}),
    staleTime: 60_000,
  });

  const allAssets = assetsData?.assets ?? [];
  const mediaTypes = assetsData?.mediaTypes ?? [];
  const claimedCodes = useMemo(
    () => new Set(claimsData?.oldCodes ?? []),
    [claimsData?.oldCodes],
  );
  const totalTickets = claimsData?.totalTickets ?? 0;

  const [fProject, setFProject] = useState("all");
  const [fMedia, setFMedia] = useState("all");
  const [q, setQ] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [onlyClaimed, setOnlyClaimed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  // Draw / route state
  const [drawMode, setDrawMode] = useState(false);
  const [polyline, setPolyline] = useState<LatLng[]>([]);
  const [radius, setRadius] = useState<number>(200);

  const filtered = useMemo(() => {
    const projectDepts = fProject !== "all"
      ? new Set(PROJECT_TO_DEPARTMENTS[fProject] ?? [])
      : null;
    return allAssets.filter((a) => {
      if (projectDepts && (!a.department || !projectDepts.has(a.department))) return false;
      if (fMedia !== "all" && a.media_type !== fMedia) return false;
      if (onlyClaimed && (!a.old_code || !claimedCodes.has(a.old_code))) return false;
      return true;
    });
  }, [allAssets, fProject, fMedia, onlyClaimed, claimedCodes]);

  // Nearby assets along polyline (within radius)
  const nearby = useMemo(() => {
    if (polyline.length === 0) return [] as Array<MapAsset & { dist: number }>;
    const out: Array<MapAsset & { dist: number }> = [];
    for (const a of filtered) {
      const d = distanceToPolyline([a.lat, a.lng], polyline);
      if (d <= radius) out.push({ ...a, dist: d });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }, [filtered, polyline, radius]);

  const nearbyIds = useMemo(
    () => (polyline.length >= 1 ? new Set(nearby.map((a) => a.id)) : null),
    [nearby, polyline.length],
  );

  const suggestions = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return [];
    const out: typeof filtered = [];
    for (const a of filtered) {
      const hay = `${a.old_code ?? ""} ${a.name ?? ""} ${a.location ?? ""}`.toLowerCase();
      if (hay.includes(qq)) out.push(a);
      if (out.length >= 12) break;
    }
    return out;
  }, [filtered, q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!searchWrapRef.current) return;
      if (!searchWrapRef.current.contains(e.target as Node)) setSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const projects = Object.keys(PROJECT_TO_DEPARTMENTS);
  const hasFilter = fProject !== "all" || fMedia !== "all" || q || onlyClaimed;

  function exportCsv() {
    const rows = [
      ["#", "Old Code", "Name", "Project", "Department", "Media Type", "Location", "Status", "Distance (m)", "Latitude", "Longitude"],
      ...nearby.map((a, i) => [
        String(i + 1),
        a.old_code ?? "",
        a.name ?? "",
        projectForDepartment(a.department) ?? "",
        a.department ?? "",
        a.media_type ?? "",
        a.location ?? "",
        a.status ?? "",
        a.dist.toFixed(1),
        String(a.lat),
        String(a.lng),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `route-nearby-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2">
      <div className="flex items-center gap-3 px-2 border-r pr-3">
        <Stat icon={<MapPin className="size-4 text-primary" />} label="Shown" value={filtered.length} />
        <Stat icon={<AlertTriangle className="size-4 text-warning" />} label="Repairing" value={totalTickets} />
        <Stat icon={<Layers className="size-4 text-muted-foreground" />} label="Total" value={allAssets.length} />
      </div>

      <div ref={searchWrapRef} className="relative flex-1 min-w-[220px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setSuggestOpen(true); }}
          onFocus={() => setSuggestOpen(true)}
          placeholder="ค้นหา Old Code / ชื่อ / ทำเล"
          className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {suggestOpen && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 z-[1100] bg-popover text-popover-foreground border rounded-md shadow-lg max-h-80 overflow-y-auto">
            {suggestions.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  setFocusId(a.id);
                  setQ(a.old_code ?? a.name ?? "");
                  setSuggestOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent border-b last:border-b-0"
              >
                <div className="font-semibold truncate">{a.old_code ?? "—"}</div>
                <div className="text-xs text-muted-foreground truncate">{a.name ?? "—"}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {[projectForDepartment(a.department) ?? a.department, a.media_type, a.location].filter(Boolean).join(" • ")}
                </div>
              </button>
            ))}
          </div>
        )}
        {suggestOpen && q.trim() && suggestions.length === 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 z-[1100] bg-popover text-popover-foreground border rounded-md shadow-lg p-3 text-xs text-muted-foreground">
            ไม่พบผลลัพธ์
          </div>
        )}
      </div>

      <CompactSelect placeholder="Project" value={fProject} onChange={setFProject} options={projects} />
      <CompactSelect placeholder="Media Type" value={fMedia} onChange={setFMedia} options={mediaTypes} />

      <label className="flex items-center gap-2 h-9 px-3 rounded-md border cursor-pointer hover:bg-accent text-xs">
        <input
          type="checkbox"
          checked={onlyClaimed}
          onChange={(e) => setOnlyClaimed(e.target.checked)}
        />
        <span>เฉพาะที่กำลังซ่อม</span>
      </label>

      {hasFilter && (
        <button
          onClick={() => { setFProject("all"); setFMedia("all"); setQ(""); setOnlyClaimed(false); setFocusId(null); }}
          className="text-xs px-2.5 h-9 rounded-md border hover:bg-accent inline-flex items-center gap-1"
          title="ล้างตัวกรอง"
        >
          <X className="size-3.5" /> Clear
        </button>
      )}

      <div className="flex items-center gap-1 border-l pl-2 ml-1">
        <button
          onClick={() => setDrawMode((v) => !v)}
          className={cn(
            "h-9 px-2.5 rounded-md border inline-flex items-center gap-1 text-xs",
            drawMode ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent",
          )}
          title="โหมดวาดเส้นทาง (คลิกบนแผนที่เพื่อเพิ่มจุด, คลิกขวาเพื่อลบจุดล่าสุด)"
        >
          <Pencil className="size-4" />
          <span className="hidden sm:inline">{drawMode ? "Drawing…" : "Draw Route"}</span>
        </button>

        <Select value={String(radius)} onValueChange={(v) => setRadius(Number(v))}>
          <SelectTrigger className="h-9 w-[110px] text-xs" title="รัศมีค้นหา">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[1100]">
            {RADIUS_PRESETS.map((r) => (
              <SelectItem key={r} value={String(r)}>
                {r >= 1000 ? `${r / 1000} km` : `${r} m`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          type="number"
          min={10}
          step={10}
          value={radius}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n > 0) setRadius(n);
          }}
          className="h-9 w-[72px] rounded-md border bg-background px-2 text-xs"
          title="รัศมี (เมตร)"
        />

        {polyline.length > 0 && (
          <button
            onClick={() => { setPolyline([]); setDrawMode(false); }}
            className="h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1 text-xs"
            title="ล้างเส้นทาง"
          >
            <Trash2 className="size-4" /> <span className="hidden sm:inline">Clear Route</span>
          </button>
        )}
        {nearby.length > 0 && (
          <button
            onClick={exportCsv}
            className="h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1 text-xs"
            title="Export CSV"
          >
            <Download className="size-4" /> <span className="hidden sm:inline">Export</span>
          </button>
        )}
      </div>

      <button
        onClick={() => setFullscreen((v) => !v)}
        className="ml-auto h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1 text-xs"
        title={fullscreen ? "ออกจากโหมดเต็มจอ" : "ขยายเต็มจอ"}
      >
        {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        <span className="hidden sm:inline">{fullscreen ? "Exit" : "Fullscreen"}</span>
      </button>
    </div>
  );

  const routeInfo = polyline.length > 0 && (
    <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-100 px-3 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="inline-flex items-center gap-1.5 font-semibold">
        <RouteIcon className="size-4" /> เส้นทางที่วาด
      </div>
      <div><span className="opacity-70">จุด:</span> <b>{polyline.length}</b></div>
      <div><span className="opacity-70">ระยะทางรวม:</span> <b>{(polylineLength(polyline) / 1000).toFixed(2)} km</b></div>
      <div><span className="opacity-70">รัศมี:</span> <b>{radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}</b></div>
      <div><span className="opacity-70">ป้ายใกล้เส้นทาง:</span> <b>{nearby.length}</b></div>
      {drawMode && (
        <div className="ml-auto opacity-80">คลิกบนแผนที่เพื่อเพิ่มจุด • คลิกขวาเพื่อลบจุดล่าสุด</div>
      )}
    </div>
  );

  const mapAndPanel = (
    <div
      className="grid gap-3"
      style={{
        gridTemplateColumns: polyline.length > 0 ? "1fr 320px" : "1fr",
      }}
    >
      <div
        className={cn(
          "rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden relative z-0",
        )}
        style={
          fullscreen
            ? { height: "calc(100vh - 140px)" }
            : { height: "calc(100vh - 280px)", minHeight: 480 }
        }
      >
        {loadingAssets ? (
          <Skeleton className="w-full h-full" />
        ) : (
          <ClientOnly fallback={<Skeleton className="w-full h-full" />}>
            <Suspense fallback={<Skeleton className="w-full h-full" />}>
              <AssetMap
                assets={filtered}
                claimedCodes={claimedCodes}
                focusId={focusId}
                drawMode={drawMode}
                polyline={polyline}
                onPolylineChange={setPolyline}
                radiusMeters={radius}
                nearbyIds={nearbyIds}
              />
            </Suspense>
          </ClientOnly>
        )}
      </div>

      {polyline.length > 0 && (
        <div
          className="rounded-xl border bg-card overflow-hidden flex flex-col"
          style={
            fullscreen
              ? { height: "calc(100vh - 140px)" }
              : { height: "calc(100vh - 280px)", minHeight: 480 }
          }
        >
          <div className="px-3 py-2 border-b flex items-center justify-between">
            <div className="text-sm font-semibold">Nearby Assets ({nearby.length})</div>
            {nearby.length > 0 && (
              <button
                onClick={exportCsv}
                className="text-xs px-2 py-1 rounded-md border hover:bg-accent inline-flex items-center gap-1"
              >
                <Download className="size-3.5" /> CSV
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto divide-y">
            {nearby.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">
                ไม่มีป้ายภายในรัศมี {radius} m — ลองเพิ่มรัศมีหรือปรับเส้นทาง
              </div>
            ) : (
              nearby.map((a, i) => (
                <button
                  key={a.id}
                  onClick={() => setFocusId(a.id)}
                  className="w-full text-left px-3 py-2 hover:bg-accent"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold truncate">
                      {i + 1}. {a.old_code ?? "—"}
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                      {a.dist < 1000 ? `${a.dist.toFixed(0)} m` : `${(a.dist / 1000).toFixed(2)} km`}
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">{a.name ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {[projectForDepartment(a.department) ?? a.department, a.media_type, a.location].filter(Boolean).join(" • ")}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[1000] bg-background p-3 flex flex-col gap-2 overflow-auto">
        {toolbar}
        {routeInfo}
        {mapAndPanel}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PageHeader
        title="Asset Map"
        subtitle="ตำแหน่งป้ายโฆษณาทั้งหมด แยกสีตาม Project • ป้ายที่มีเคลมเปิดจะขึ้นสัญลักษณ์เตือนสีเหลือง • วาดเส้นทางเพื่อค้นหาป้ายใกล้เคียง"
      />
      {toolbar}
      {routeInfo}
      {mapAndPanel}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <div className="leading-tight">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold tabular-nums">{value.toLocaleString()}</div>
      </div>
    </div>
  );
}

function CompactSelect({
  placeholder,
  value,
  onChange,
  options,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-[150px] text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="z-[1100]">
        <SelectItem value="all">{placeholder}: ทั้งหมด</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
