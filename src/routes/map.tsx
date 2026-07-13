import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Undo2,
  Redo2,
  Save,
  FolderOpen,
  Plus,
  Star,
  Wand2,
  Navigation,
  ArrowUp,
  ArrowDown,
  Loader2,
  ExternalLink,
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
import {
  listSavedLocations,
  upsertSavedLocation,
  deleteSavedLocation,
  listSavedRoutes,
  upsertSavedRoute,
  deleteSavedRoute,
  type SavedLocation,
  type SavedRoute,
} from "@/lib/map-store.functions";
import { PROJECT_TO_DEPARTMENTS, projectForDepartment } from "@/lib/project-department-map";
import {
  osrmRoute,
  osrmTrip,
  buildGpx,
  buildKml,
  downloadText,
  googleMapsDirectionsUrl,
  googleMapsAltDirectionsUrl,
  appleMapsDirectionsUrl,
  osmDirectionsUrl,
  wazeNavigateUrl,
  type LatLng,
} from "@/lib/osrm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Copy, ChevronDown, QrCode, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";

import type { PoiMarker } from "@/components/asset-map";
import type { POI, POIMatch } from "@/lib/poi-search.functions";
import { PRESET_BY_KEY } from "@/lib/overpass";

const AssetMap = lazy(() => import("@/components/asset-map"));
const PoiProximityPanel = lazy(() => import("@/components/poi-proximity-panel"));
const BillboardAnalyticsPanel = lazy(() => import("@/components/billboard-analytics-panel"));


export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "Asset Map — Asset History 360" },
      {
        name: "description",
        content:
          "แผนที่ป้ายโฆษณา วาดเส้นทาง ค้นป้ายใกล้เคียง วางแผนงานตรวจสื่อ พร้อม auto-routing ผ่าน OSRM",
      },
    ],
  }),
  component: MapPage,
});

const RADIUS_PRESETS = [50, 100, 200, 500, 1000];

// ---------- geometry helpers ----------
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
function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const lat0 = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos(lat0);
  const bx = (b[1] - a[1]) * mLng;
  const by = (b[0] - a[0]) * mLat;
  const px = (p[1] - a[1]) * mLng;
  const py = (p[0] - a[0]) * mLat;
  const len2 = bx * bx + by * by;
  let t = len2 === 0 ? 0 : (px * bx + py * by) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = t * bx;
  const cy = t * by;
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
function fmtDist(m: number) {
  return m < 1000 ? `${m.toFixed(0)} m` : `${(m / 1000).toFixed(2)} km`;
}
function fmtDur(sec: number) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  return `${h} ชม ${m % 60} นาที`;
}

// ---------- Types ----------
type Mode = "corridor" | "inspection" | "poi";

type Stop = {
  key: string; // client key
  asset_id?: string | null;
  old_code?: string | null;
  name?: string | null;
  lat: number;
  lng: number;
};

function MapPage() {
  // ---------- data ----------
  const assetsFn = useServerFn(listAssetsForMap);
  const claimsFn = useServerFn(listOpenClaimOldCodes);
  const listLocFn = useServerFn(listSavedLocations);
  const listRouteFn = useServerFn(listSavedRoutes);
  const upsertLocFn = useServerFn(upsertSavedLocation);
  const deleteLocFn = useServerFn(deleteSavedLocation);
  const upsertRouteFn = useServerFn(upsertSavedRoute);
  const deleteRouteFn = useServerFn(deleteSavedRoute);
  const qc = useQueryClient();

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
  const { data: locsData } = useQuery({
    queryKey: ["map", "saved-locations"],
    queryFn: () => listLocFn({}),
    staleTime: 60_000,
  });
  const { data: routesData } = useQuery({
    queryKey: ["map", "saved-routes"],
    queryFn: () => listRouteFn({}),
    staleTime: 60_000,
  });

  const allAssets = assetsData?.assets ?? [];
  const mediaTypes = assetsData?.mediaTypes ?? [];
  const claimedCodes = useMemo(
    () => new Set(claimsData?.oldCodes ?? []),
    [claimsData?.oldCodes],
  );
  const totalTickets = claimsData?.totalTickets ?? 0;
  const savedLocations = locsData?.rows ?? [];
  const savedRoutes = routesData?.rows ?? [];

  // ---------- shared UI state ----------
  const [mode, setMode] = useState<Mode>("corridor");
  const [fProject, setFProject] = useState("all");
  const [fMedia, setFMedia] = useState("all");
  const [q, setQ] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [onlyClaimed, setOnlyClaimed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  // ---------- Corridor state (with undo/redo) ----------
  const [drawMode, setDrawMode] = useState(false);
  const [polyline, setPolyline] = useState<LatLng[]>([]);
  const [radius, setRadius] = useState<number>(200);
  const historyRef = useRef<{ past: LatLng[][]; future: LatLng[][] }>({ past: [], future: [] });
  const [, forceHistoryRerender] = useState(0);
  const setPolylineTracked = useCallback((next: LatLng[] | ((p: LatLng[]) => LatLng[])) => {
    setPolyline((prev) => {
      const value = typeof next === "function" ? (next as (p: LatLng[]) => LatLng[])(prev) : next;
      historyRef.current.past.push(prev);
      if (historyRef.current.past.length > 50) historyRef.current.past.shift();
      historyRef.current.future = [];
      forceHistoryRerender((n) => n + 1);
      return value;
    });
  }, []);
  const undo = () => {
    setPolyline((prev) => {
      const p = historyRef.current.past.pop();
      if (!p) return prev;
      historyRef.current.future.push(prev);
      forceHistoryRerender((n) => n + 1);
      return p;
    });
  };
  const redo = () => {
    setPolyline((prev) => {
      const f = historyRef.current.future.pop();
      if (!f) return prev;
      historyRef.current.past.push(prev);
      forceHistoryRerender((n) => n + 1);
      return f;
    });
  };
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  // ---------- Inspection (trip) state ----------
  const [origin, setOrigin] = useState<{ lat: number; lng: number; name?: string } | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [originPickMode, setOriginPickMode] = useState(false);
  const [stopPickMode, setStopPickMode] = useState(false);
  const [roadPolyline, setRoadPolyline] = useState<LatLng[] | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number; legs: { distance: number; duration: number }[] } | null>(null);
  const [routing, setRouting] = useState(false);

  // ---------- POI proximity state ----------
  const [mapBbox, setMapBbox] = useState<[number, number, number, number] | null>(null);
  const [poiResult, setPoiResult] = useState<{ pois: POI[]; matches: POIMatch[]; radiusM: number } | null>(null);
  const [focusPoiId, setFocusPoiId] = useState<string | null>(null);
  const [analyticsAsset, setAnalyticsAsset] = useState<MapAsset | null>(null);


  const assetIndexById = useMemo(() => {
    const m = new Map<string, { old_code: string | null; name: string | null }>();
    for (const a of allAssets) m.set(a.id, { old_code: a.old_code, name: a.name });
    return m;
  }, [allAssets]);

  const poiMarkers = useMemo<PoiMarker[]>(() => {
    if (mode !== "poi" || !poiResult) return [];
    return poiResult.pois.map((p) => {
      const preset = PRESET_BY_KEY[p.presetKey];
      return {
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        name: p.name,
        icon: preset?.icon ?? "📍",
        color: preset?.color ?? "#a855f7",
        categoryLabel: preset?.label ?? p.presetKey,
      };
    });
  }, [mode, poiResult]);

  const poiMatchedAssetIds = useMemo(() => {
    if (mode !== "poi" || !poiResult) return null;
    return new Set(poiResult.matches.map((m) => m.assetId));
  }, [mode, poiResult]);

  // ---------- Filters ----------
  const filtered = useMemo(() => {
    const projectDepts = fProject !== "all" ? new Set(PROJECT_TO_DEPARTMENTS[fProject] ?? []) : null;
    return allAssets.filter((a) => {
      if (projectDepts && (!a.department || !projectDepts.has(a.department))) return false;
      if (fMedia !== "all" && a.media_type !== fMedia) return false;
      if (onlyClaimed && (!a.old_code || !claimedCodes.has(a.old_code))) return false;
      return true;
    });
  }, [allAssets, fProject, fMedia, onlyClaimed, claimedCodes]);

  // Corridor: nearby along drawn polyline
  const nearby = useMemo(() => {
    if (mode !== "corridor" || polyline.length === 0) return [] as Array<MapAsset & { dist: number }>;
    const out: Array<MapAsset & { dist: number }> = [];
    for (const a of filtered) {
      const d = distanceToPolyline([a.lat, a.lng], polyline);
      if (d <= radius) out.push({ ...a, dist: d });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }, [mode, filtered, polyline, radius]);

  // Highlight set on the map
  const highlightIds = useMemo(() => {
    if (mode === "corridor" && polyline.length > 0) return new Set(nearby.map((a) => a.id));
    if (mode === "inspection" && stops.length > 0)
      return new Set(stops.map((s) => s.asset_id).filter(Boolean) as string[]);
    if (mode === "poi" && poiMatchedAssetIds) return poiMatchedAssetIds;
    return null;
  }, [mode, polyline.length, nearby, stops, poiMatchedAssetIds]);

  const suggestions = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return [];
    const out: MapAsset[] = [];
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

  // ---------- Inspection actions ----------
  const addStop = (a: MapAsset) => {
    setStops((prev) =>
      prev.some((s) => s.asset_id === a.id)
        ? prev
        : [
            ...prev,
            {
              key: `${a.id}-${Date.now()}`,
              asset_id: a.id,
              old_code: a.old_code,
              name: a.name,
              lat: a.lat,
              lng: a.lng,
            },
          ],
    );
    setRoadPolyline(null);
    setRouteInfo(null);
  };
  const removeStop = (key: string) => {
    setStops((prev) => prev.filter((s) => s.key !== key));
    setRoadPolyline(null);
    setRouteInfo(null);
  };
  const moveStop = (index: number, dir: -1 | 1) => {
    setStops((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
    setRoadPolyline(null);
    setRouteInfo(null);
  };

  const routePoints: LatLng[] = useMemo(() => {
    const pts: LatLng[] = [];
    if (origin) pts.push([origin.lat, origin.lng]);
    for (const s of stops) pts.push([s.lat, s.lng]);
    return pts;
  }, [origin, stops]);

  const runAutoRoute = async () => {
    if (routePoints.length < 2) {
      toast.error("ต้องมีต้นทางและปลายทางอย่างน้อย 1 จุด");
      return;
    }
    setRouting(true);
    try {
      const r = await osrmRoute(routePoints);
      setRoadPolyline(r.geometry);
      setRouteInfo({ distance: r.distance, duration: r.duration });
      toast.success("คำนวณเส้นทางสำเร็จ");
    } catch (e) {
      toast.error(`คำนวณเส้นทางล้มเหลว: ${(e as Error).message}`);
    } finally {
      setRouting(false);
    }
  };

  const runOptimize = async () => {
    if (!origin || stops.length < 2) {
      toast.error("ต้องมีต้นทาง และปลายทางอย่างน้อย 2 จุด เพื่อจัดลำดับ");
      return;
    }
    setRouting(true);
    try {
      const r = await osrmTrip(routePoints, { fixedStart: true, roundtrip: false });
      // r.waypointOrder[i] = visit order for input i. Input 0 = origin.
      // Sort stops by their visit order.
      const pairs = stops.map((s, i) => ({ s, order: r.waypointOrder[i + 1] }));
      pairs.sort((a, b) => a.order - b.order);
      setStops(pairs.map((p) => p.s));
      setRoadPolyline(r.geometry);
      setRouteInfo({ distance: r.distance, duration: r.duration });
      toast.success("จัดลำดับสั้นที่สุดสำเร็จ");
    } catch (e) {
      toast.error(`จัดลำดับล้มเหลว: ${(e as Error).message}`);
    } finally {
      setRouting(false);
    }
  };

  const clearInspection = () => {
    setStops([]);
    setOrigin(null);
    setRoadPolyline(null);
    setRouteInfo(null);
    setOriginPickMode(false);
    setStopPickMode(false);
  };

  // ---------- Exports ----------
  function exportCsv() {
    const rows =
      mode === "corridor"
        ? [
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
          ]
        : [
            ["ลำดับ", "Old Code", "Name", "Latitude", "Longitude"],
            ...(origin ? [["0 (ต้นทาง)", "", origin.name ?? "Origin", String(origin.lat), String(origin.lng)]] : []),
            ...stops.map((s, i) => [String(i + 1), s.old_code ?? "", s.name ?? "", String(s.lat), String(s.lng)]),
          ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `map-${mode}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportGpx() {
    const track: LatLng[] =
      mode === "corridor"
        ? polyline
        : roadPolyline && roadPolyline.length >= 2
        ? roadPolyline
        : routePoints;
    const wpts =
      mode === "corridor"
        ? nearby.map((a) => ({ lat: a.lat, lng: a.lng, name: a.old_code ?? a.name ?? "", description: a.name ?? "" }))
        : [
            ...(origin ? [{ lat: origin.lat, lng: origin.lng, name: origin.name ?? "Origin" }] : []),
            ...stops.map((s, i) => ({ lat: s.lat, lng: s.lng, name: `${i + 1}. ${s.old_code ?? s.name ?? ""}` })),
          ];
    if (track.length < 2) {
      toast.error("ต้องมีเส้นทางอย่างน้อย 2 จุด");
      return;
    }
    downloadText(`map-${mode}.gpx`, "application/gpx+xml", buildGpx(`Route ${mode}`, track, wpts));
  }
  function exportKml() {
    const track: LatLng[] =
      mode === "corridor"
        ? polyline
        : roadPolyline && roadPolyline.length >= 2
        ? roadPolyline
        : routePoints;
    const wpts =
      mode === "corridor"
        ? nearby.map((a) => ({ lat: a.lat, lng: a.lng, name: a.old_code ?? a.name ?? "", description: a.name ?? "" }))
        : [
            ...(origin ? [{ lat: origin.lat, lng: origin.lng, name: origin.name ?? "Origin" }] : []),
            ...stops.map((s, i) => ({ lat: s.lat, lng: s.lng, name: `${i + 1}. ${s.old_code ?? s.name ?? ""}` })),
          ];
    if (track.length < 2) {
      toast.error("ต้องมีเส้นทางอย่างน้อย 2 จุด");
      return;
    }
    downloadText(`map-${mode}.kml`, "application/vnd.google-earth.kml+xml", buildKml(`Route ${mode}`, track, wpts));
  }
  // For Corridor mode: sample the drawn polyline down to ≤10 points (Google Maps waypoint cap).
  const mapsPoints = (() => {
    if (mode === "inspection") return routePoints;
    if (polyline.length < 2) return [] as typeof polyline;
    const MAX = 10;
    if (polyline.length <= MAX) return polyline;
    const out: typeof polyline = [polyline[0]];
    const step = (polyline.length - 1) / (MAX - 1);
    for (let i = 1; i < MAX - 1; i++) out.push(polyline[Math.round(i * step)]);
    out.push(polyline[polyline.length - 1]);
    return out;
  })();
  const hasRoute = mapsPoints.length >= 2;
  const gmapsUrl = hasRoute ? googleMapsDirectionsUrl(mapsPoints) : "";
  const gmapsAltUrl = hasRoute ? googleMapsAltDirectionsUrl(mapsPoints) : "";
  const appleUrl = hasRoute ? appleMapsDirectionsUrl(mapsPoints) : "";
  const osmUrl = hasRoute ? osmDirectionsUrl(mapsPoints) : "";
  const wazeUrl = hasRoute ? wazeNavigateUrl(mapsPoints) : "";
  const copyGmapsUrl = async () => {
    if (!gmapsUrl) return;
    try {
      await navigator.clipboard.writeText(gmapsUrl);
      toast.success("คัดลอกลิงก์ Google Maps แล้ว");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  };
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const openQr = async () => {
    if (!gmapsUrl) return;
    try {
      const url = await QRCode.toDataURL(gmapsUrl, { width: 512, margin: 2 });
      setQrDataUrl(url);
      setQrOpen(true);
    } catch {
      toast.error("สร้าง QR ไม่สำเร็จ");
    }
  };

  // ---------- Save/Load routes ----------
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveShared, setSaveShared] = useState(false);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!saveName.trim()) throw new Error("ตั้งชื่อก่อน");
      const payload =
        mode === "corridor"
          ? {
              name: saveName,
              kind: "corridor" as const,
              origin: null,
              waypoints: polyline.map(([lat, lng]) => ({ lat, lng })),
              road_polyline: null,
              radius_m: radius,
              is_shared: saveShared,
            }
          : {
              name: saveName,
              kind: "inspection" as const,
              origin: origin ? { lat: origin.lat, lng: origin.lng, name: origin.name ?? null } : null,
              waypoints: stops.map((s) => ({
                lat: s.lat,
                lng: s.lng,
                asset_id: s.asset_id ?? null,
                old_code: s.old_code ?? null,
                name: s.name ?? null,
              })),
              road_polyline: roadPolyline,
              radius_m: radius,
              is_shared: saveShared,
            };
      return upsertRouteFn({ data: payload });
    },
    onSuccess: () => {
      toast.success("บันทึกเส้นทางแล้ว");
      qc.invalidateQueries({ queryKey: ["map", "saved-routes"] });
      setSaveOpen(false);
      setSaveName("");
      setSaveShared(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loadRoute = (r: SavedRoute) => {
    setMode(r.kind);
    if (r.kind === "corridor") {
      setPolyline(r.waypoints.map((w) => [w.lat, w.lng] as LatLng));
      historyRef.current = { past: [], future: [] };
      setRadius(r.radius_m);
      setStops([]);
      setOrigin(null);
      setRoadPolyline(null);
    } else {
      setOrigin(r.origin ? { lat: r.origin.lat, lng: r.origin.lng, name: r.origin.name ?? undefined } : null);
      setStops(
        r.waypoints.map((w, i) => ({
          key: `loaded-${i}-${Date.now()}`,
          asset_id: w.asset_id ?? null,
          old_code: w.old_code ?? null,
          name: w.name ?? null,
          lat: w.lat,
          lng: w.lng,
        })),
      );
      setRoadPolyline(r.road_polyline);
      setPolyline([]);
    }
    setLoadOpen(false);
    toast.success(`โหลด: ${r.name}`);
  };

  const deleteRouteMut = useMutation({
    mutationFn: (id: string) => deleteRouteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["map", "saved-routes"] });
      toast.success("ลบแล้ว");
    },
  });

  // Saved location handlers
  const [newLocName, setNewLocName] = useState("");
  const [newLocAddr, setNewLocAddr] = useState("");
  const [newLocShared, setNewLocShared] = useState(false);
  const [pendingOriginLatLng, setPendingOriginLatLng] = useState<{ lat: number; lng: number } | null>(null);

  const saveLocMut = useMutation({
    mutationFn: async (arg: { lat: number; lng: number }) => {
      if (!newLocName.trim()) throw new Error("กรุณาตั้งชื่อ");
      return upsertLocFn({
        data: {
          name: newLocName,
          address: newLocAddr || null,
          lat: arg.lat,
          lng: arg.lng,
          is_shared: newLocShared,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["map", "saved-locations"] });
      setNewLocName("");
      setNewLocAddr("");
      setNewLocShared(false);
      setPendingOriginLatLng(null);
      toast.success("บันทึกต้นทางแล้ว");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteLocMut = useMutation({
    mutationFn: (id: string) => deleteLocFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["map", "saved-locations"] }),
  });

  const useSavedLocation = (l: SavedLocation) => {
    setOrigin({ lat: l.lat, lng: l.lng, name: l.name });
    setLocOpen(false);
    setRoadPolyline(null);
    setRouteInfo(null);
    toast.success(`เลือกต้นทาง: ${l.name}`);
  };

  // ---------- Search suggestion click behavior differs per mode ----------
  const handleSuggestionClick = (a: MapAsset) => {
    if (mode === "inspection") {
      addStop(a);
      setQ("");
      setSuggestOpen(false);
      toast.success(`เพิ่มปลายทาง: ${a.old_code ?? a.name}`);
    } else {
      setFocusId(a.id);
      setQ(a.old_code ?? a.name ?? "");
      setSuggestOpen(false);
    }
  };

  // ---------- Render ----------
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2">
      <div className="flex items-center gap-3 px-2 border-r pr-3">
        <Stat icon={<MapPin className="size-4 text-primary" />} label="Shown" value={filtered.length} />
        <Stat icon={<AlertTriangle className="size-4 text-warning" />} label="Repairing" value={totalTickets} />
        <Stat icon={<Layers className="size-4 text-muted-foreground" />} label="Total" value={allAssets.length} />
      </div>

      {/* Mode tabs */}
      <div className="inline-flex rounded-md border overflow-hidden text-xs">
        <button
          className={cn("px-3 h-9", mode === "corridor" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          onClick={() => setMode("corridor")}
          title="วาดเส้นทางค้นหาป้ายในรัศมี"
        >
          <Pencil className="size-3.5 inline mr-1" /> Corridor
        </button>
        <button
          className={cn("px-3 h-9 border-l", mode === "inspection" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          onClick={() => setMode("inspection")}
          title="วางแผนตรวจสื่อ (ต้นทาง → ปลายทางหลายจุด)"
        >
          <Navigation className="size-3.5 inline mr-1" /> Inspection
        </button>
        <button
          className={cn("px-3 h-9 border-l", mode === "poi" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          onClick={() => setMode("poi")}
          title="ค้นหาป้ายใกล้ POI (ห้าง โชว์รูม BTS ฯลฯ)"
        >
          <MapPin className="size-3.5 inline mr-1" /> POI Search
        </button>
      </div>

      <div ref={searchWrapRef} className="relative flex-1 min-w-[220px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSuggestOpen(true);
          }}
          onFocus={() => setSuggestOpen(true)}
          placeholder={mode === "inspection" ? "ค้นหาป้ายเพื่อเพิ่มปลายทาง…" : "ค้นหา Old Code / ชื่อ / ทำเล"}
          className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {suggestOpen && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 z-[1100] bg-popover text-popover-foreground border rounded-md shadow-lg max-h-80 overflow-y-auto">
            {suggestions.map((a) => (
              <button
                key={a.id}
                onClick={() => handleSuggestionClick(a)}
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
        <input type="checkbox" checked={onlyClaimed} onChange={(e) => setOnlyClaimed(e.target.checked)} />
        <span>เฉพาะที่กำลังซ่อม</span>
      </label>

      {hasFilter && (
        <button
          onClick={() => {
            setFProject("all");
            setFMedia("all");
            setQ("");
            setOnlyClaimed(false);
            setFocusId(null);
          }}
          className="text-xs px-2.5 h-9 rounded-md border hover:bg-accent inline-flex items-center gap-1"
          title="ล้างตัวกรอง"
        >
          <X className="size-3.5" /> Clear
        </button>
      )}

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

  // Mode-specific action bar (hidden in POI mode — panel has its own controls)
  const modeBar = mode === "poi" ? null : (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/50 p-2 text-xs">
      {mode === "corridor" ? (
        <>
          <button
            onClick={() => setDrawMode((v) => !v)}
            className={cn(
              "h-9 px-2.5 rounded-md border inline-flex items-center gap-1",
              drawMode ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent",
            )}
            title="โหมดวาดเส้นทาง (คลิกเพื่อเพิ่มจุด, คลิกขวาบนหมุดเพื่อลบจุด, ลากหมุดเพื่อขยับ)"
          >
            <Pencil className="size-4" />
            <span>{drawMode ? "Drawing…" : "Draw Route"}</span>
          </button>
          <button onClick={undo} disabled={!canUndo} className="h-9 w-9 rounded-md border hover:bg-accent disabled:opacity-40 grid place-items-center" title="Undo (Ctrl+Z)">
            <Undo2 className="size-4" />
          </button>
          <button onClick={redo} disabled={!canRedo} className="h-9 w-9 rounded-md border hover:bg-accent disabled:opacity-40 grid place-items-center" title="Redo">
            <Redo2 className="size-4" />
          </button>

          <div className="flex items-center gap-1">
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
          </div>

          {polyline.length > 0 && (
            <button
              onClick={() => setPolylineTracked([])}
              className="h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1"
            >
              <Trash2 className="size-4" /> Clear
            </button>
          )}
        </>
      ) : (
        <>
          <button
            onClick={() => setLocOpen((v) => !v)}
            className="h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1"
            title="เลือกต้นทางจากที่บันทึกไว้"
          >
            <Star className="size-4" /> Origins
          </button>
          <button
            onClick={() => { setOriginPickMode((v) => !v); setStopPickMode(false); }}
            className={cn(
              "h-9 px-2.5 rounded-md border inline-flex items-center gap-1",
              originPickMode ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent",
            )}
            title="คลิกบนแผนที่เพื่อกำหนดต้นทาง"
          >
            <MapPin className="size-4" /> {originPickMode ? "Click map…" : "Pick Origin"}
          </button>
          <button
            onClick={() => { setStopPickMode((v) => !v); setOriginPickMode(false); }}
            className={cn(
              "h-9 px-2.5 rounded-md border inline-flex items-center gap-1",
              stopPickMode ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent",
            )}
            title="คลิกบนแผนที่เพื่อเพิ่มปลายทาง (จุดที่คลิกจะกลายเป็นปลายทางใหม่)"
          >
            <Plus className="size-4" /> {stopPickMode ? "Click map…" : "Pick Stop"}
          </button>
          {origin && (
            <span className="inline-flex items-center gap-2 h-9 px-2.5 rounded-md border bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-200">
              <Star className="size-3.5" /> {origin.name ?? "Origin"}
              <button onClick={() => setOrigin(null)} className="opacity-70 hover:opacity-100">
                <X className="size-3" />
              </button>
            </span>
          )}
          <button
            onClick={runAutoRoute}
            disabled={routing || routePoints.length < 2}
            className="h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1 disabled:opacity-40"
            title="คำนวณเส้นทางบนถนนจริง (OSRM)"
          >
            {routing ? <Loader2 className="size-4 animate-spin" /> : <RouteIcon className="size-4" />} Auto Route
          </button>
          <button
            onClick={runOptimize}
            disabled={routing || !origin || stops.length < 2}
            className="h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1 disabled:opacity-40"
            title="จัดลำดับปลายทางให้สั้นที่สุด (TSP ผ่าน OSRM /trip)"
          >
            <Wand2 className="size-4" /> Optimize
          </button>
          {(stops.length > 0 || origin) && (
            <button
              onClick={clearInspection}
              className="h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1"
            >
              <Trash2 className="size-4" /> Clear
            </button>
          )}
        </>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={() => setLoadOpen((v) => !v)}
          className="h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1"
          title="โหลดเส้นทางที่บันทึก"
        >
          <FolderOpen className="size-4" /> Load
        </button>
        <button
          onClick={() => setSaveOpen((v) => !v)}
          disabled={mode === "corridor" ? polyline.length < 2 : !origin && stops.length === 0}
          className="h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1 disabled:opacity-40"
          title="บันทึกเส้นทาง"
        >
          <Save className="size-4" /> Save
        </button>
        <button onClick={exportCsv} disabled={mode === "corridor" ? nearby.length === 0 : stops.length === 0}
          className="h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1 disabled:opacity-40" title="Export CSV">
          <Download className="size-4" /> CSV
        </button>
        <button onClick={exportGpx} className="h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1" title="Export GPX (มือถือ)">
          GPX
        </button>
        <button onClick={exportKml} className="h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1" title="Export KML (Google Earth)">
          KML
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!hasRoute}
            className="h-9 px-2.5 rounded-md border hover:bg-accent inline-flex items-center gap-1 text-blue-700 dark:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
            title={hasRoute ? "เปิดในบริการแผนที่" : mode === "corridor" ? "ต้องวาดเส้นทางอย่างน้อย 2 จุด" : "ต้องมีต้นทาง + ปลายทางอย่างน้อย 1 จุด"}
          >
            <ExternalLink className="size-4" /> Maps <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[1100]">
            <DropdownMenuItem asChild>
              <a href={gmapsUrl} target="_blank" rel="noreferrer">Google Maps</a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={gmapsAltUrl} target="_blank" rel="noreferrer">Google Maps (google.co.th)</a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={osmUrl} target="_blank" rel="noreferrer">OpenStreetMap</a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={appleUrl} target="_blank" rel="noreferrer">Apple Maps (iOS/Mac)</a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={wazeUrl} target="_blank" rel="noreferrer">Waze (ปลายทางสุดท้าย)</a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={openQr}>
              <QrCode className="size-3.5 mr-2" /> QR Code (สแกนเปิดบนมือถือ)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={copyGmapsUrl}>
              <Copy className="size-3.5 mr-2" /> Copy Google Maps URL
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {qrOpen && (
        <div className="fixed inset-0 z-[1200] bg-black/60 grid place-items-center p-4" onClick={() => setQrOpen(false)}>
          <div className="bg-background rounded-lg p-5 max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">สแกนด้วยมือถือเพื่อเปิด Google Maps</div>
              <button onClick={() => setQrOpen(false)} className="p-1 hover:bg-accent rounded"><XIcon className="size-4" /></button>
            </div>
            {qrDataUrl && <img src={qrDataUrl} alt="QR" className="w-full h-auto rounded border" />}
            <p className="text-xs text-muted-foreground mt-3">เปิดกล้องมือถือ สแกน QR แล้วแตะลิงก์ที่ขึ้นมา — Google Maps บนมือถือจะเปิดเส้นทางให้เอง</p>
            <button onClick={copyGmapsUrl} className="mt-3 w-full h-9 rounded-md border hover:bg-accent inline-flex items-center justify-center gap-2 text-sm">
              <Copy className="size-3.5" /> คัดลอกลิงก์แทน
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const routeInfoBar =
    mode === "corridor" && polyline.length > 0 ? (
      <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-100 px-3 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="inline-flex items-center gap-1.5 font-semibold">
          <RouteIcon className="size-4" /> Corridor
        </div>
        <div>จุด: <b>{polyline.length}</b></div>
        <div>ระยะทางรวม: <b>{fmtDist(polylineLength(polyline))}</b></div>
        <div>รัศมี: <b>{radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}</b></div>
        <div>ป้ายใกล้เส้นทาง: <b>{nearby.length}</b></div>
        {drawMode && <div className="ml-auto opacity-80">คลิก = เพิ่มจุด • ลากหมุด = ขยับ • คลิกขวาบนหมุด = ลบ</div>}
      </div>
    ) : mode === "inspection" && routeInfo ? (
      <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-100 px-3 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="inline-flex items-center gap-1.5 font-semibold">
          <Navigation className="size-4" /> Inspection Trip
        </div>
        <div>จุดหมาย: <b>{stops.length}</b></div>
        <div>ระยะทางถนน: <b>{fmtDist(routeInfo.distance)}</b></div>
        <div>เวลาโดยประมาณ: <b>{fmtDur(routeInfo.duration)}</b></div>
        {originPickMode && <div className="ml-auto opacity-80">คลิกบนแผนที่เพื่อกำหนดต้นทาง</div>}
      </div>
    ) : null;

  const rightPanel =
    mode === "corridor" && polyline.length > 0 ? (
      <div className="rounded-xl border bg-card overflow-hidden flex flex-col" style={panelStyle(fullscreen)}>
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <div className="text-sm font-semibold">Nearby Assets ({nearby.length})</div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y">
          {nearby.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">ไม่มีป้ายในรัศมี {radius} m</div>
          ) : (
            nearby.map((a, i) => (
              <button key={a.id} onClick={() => setFocusId(a.id)} className="w-full text-left px-3 py-2 hover:bg-accent">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold truncate">{i + 1}. {a.old_code ?? "—"}</div>
                  <div className="text-[11px] text-muted-foreground tabular-nums shrink-0">{fmtDist(a.dist)}</div>
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
    ) : mode === "inspection" ? (
      <div className="rounded-xl border bg-card overflow-hidden flex flex-col" style={panelStyle(fullscreen)}>
        <div className="px-3 py-2 border-b text-sm font-semibold">
          Plan · {stops.length} จุดหมาย {origin ? "" : "· ยังไม่ได้เลือกต้นทาง"}
        </div>
        <div className="flex-1 overflow-y-auto divide-y">
          {origin && (
            <div className="px-3 py-2 bg-green-50 dark:bg-green-950/30">
              <div className="text-[10px] uppercase font-semibold text-green-700 dark:text-green-300">ต้นทาง</div>
              <div className="text-xs font-semibold">{origin.name ?? "Origin"}</div>
              <div className="text-[10px] text-muted-foreground">{origin.lat.toFixed(5)}, {origin.lng.toFixed(5)}</div>
            </div>
          )}
          {stops.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">
              ยังไม่มีปลายทาง — ค้นหาป้ายจากช่องค้นหาด้านบน แล้วคลิกเพื่อเพิ่ม
            </div>
          ) : (
            stops.map((s, i) => (
              <div key={s.key} className="px-3 py-2 flex items-start gap-2 hover:bg-accent">
                <button onClick={() => s.asset_id && setFocusId(s.asset_id)} className="flex-1 text-left">
                  <div className="text-xs font-semibold truncate">{i + 1}. {s.old_code ?? s.name ?? "—"}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{s.name ?? ""}</div>
                  <div className="text-[10px] text-muted-foreground">{s.lat.toFixed(5)}, {s.lng.toFixed(5)}</div>
                </button>
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => moveStop(i, -1)} disabled={i === 0} className="p-0.5 hover:bg-background rounded disabled:opacity-30">
                    <ArrowUp className="size-3" />
                  </button>
                  <button onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1} className="p-0.5 hover:bg-background rounded disabled:opacity-30">
                    <ArrowDown className="size-3" />
                  </button>
                </div>
                <button onClick={() => removeStop(s.key)} className="p-1 hover:bg-background rounded text-red-600" title="ลบ">
                  <X className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    ) : null;

  const poiPanel =
    mode === "poi" ? (
      <div style={panelStyle(fullscreen)}>
        <Suspense fallback={<Skeleton className="w-full h-full" />}>
          <PoiProximityPanel
            bbox={mapBbox}
            onResult={(r) => {
              setPoiResult(r);
              setFocusPoiId(null);
            }}
            onFocusAsset={(id) => setFocusId(id)}
            onFocusPOI={(p) => setFocusPoiId(p.id)}
            assetIndexById={assetIndexById}
          />
        </Suspense>
      </div>
    ) : null;

  const showRightPanel = (mode === "corridor" && polyline.length > 0) || mode === "inspection" || mode === "poi";

  const mapAndPanel = (
    <div className="grid gap-3" style={{ gridTemplateColumns: showRightPanel ? "1fr 340px" : "1fr" }}>
      <div className="rounded-xl border bg-card shadow-[var(--shadow-card)] overflow-hidden relative z-0"
        style={fullscreen ? { height: "calc(100vh - 200px)" } : { height: "calc(100vh - 280px)", minHeight: 480 }}>
        {loadingAssets ? (
          <Skeleton className="w-full h-full" />
        ) : (
          <ClientOnly fallback={<Skeleton className="w-full h-full" />}>
            <Suspense fallback={<Skeleton className="w-full h-full" />}>
              <AssetMap
                assets={filtered}
                claimedCodes={claimedCodes}
                focusId={focusId}
                drawMode={mode === "corridor" && drawMode}
                polyline={mode === "corridor" ? polyline : []}
                onPolylineChange={mode === "corridor" ? setPolylineTracked : undefined}
                radiusMeters={radius}
                nearbyIds={highlightIds}
                roadPolyline={mode === "inspection" ? roadPolyline : null}
                origin={mode === "inspection" ? origin : null}
                originPickMode={mode === "inspection" && originPickMode}
                onOriginPick={(lat, lng) => {
                  setOrigin({ lat, lng, name: "Origin (map pick)" });
                  setPendingOriginLatLng({ lat, lng });
                  setOriginPickMode(false);
                  setRoadPolyline(null);
                  setRouteInfo(null);
                }}
                stopPickMode={mode === "inspection" && stopPickMode}
                onStopPick={(lat, lng) => {
                  setStops((prev) => [
                    ...prev,
                    {
                      key: `pin-${Date.now()}`,
                      asset_id: null,
                      old_code: null,
                      name: `จุด (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
                      lat,
                      lng,
                    },
                  ]);
                  setRoadPolyline(null);
                  setRouteInfo(null);
                }}
                showRadiusRings={mode === "corridor"}
                poiMarkers={poiMarkers}
                poiRadiusMeters={mode === "poi" && poiResult ? poiResult.radiusM : 0}
                focusPoiId={focusPoiId}
                onBboxChange={setMapBbox}
                onSelectAsset={mode === "inspection" ? undefined : setAnalyticsAsset}

              />
            </Suspense>
          </ClientOnly>
        )}
      </div>
      {mode === "poi" ? poiPanel : (showRightPanel && rightPanel)}
    </div>
  );

  // ----- Save / Load / Locations dialogs (inline popovers) -----
  const savedDialogs = (
    <>
      {saveOpen && (
        <Sheet title="บันทึกเส้นทาง" onClose={() => setSaveOpen(false)}>
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="ตั้งชื่อเส้นทาง"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={saveShared} onChange={(e) => setSaveShared(e.target.checked)} />
            แชร์ให้ทุกคนในองค์กร
          </label>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setSaveOpen(false)} className="h-9 px-3 rounded-md border text-xs">Cancel</button>
            <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs inline-flex items-center gap-1">
              {saveMut.isPending && <Loader2 className="size-3.5 animate-spin" />} บันทึก
            </button>
          </div>
        </Sheet>
      )}
      {loadOpen && (
        <Sheet title="เส้นทางที่บันทึกไว้" onClose={() => setLoadOpen(false)}>
          {savedRoutes.length === 0 ? (
            <div className="text-xs text-muted-foreground">ยังไม่มีเส้นทาง</div>
          ) : (
            <div className="max-h-[380px] overflow-y-auto divide-y border rounded-md">
              {savedRoutes.map((r) => (
                <div key={r.id} className="p-2 flex items-center gap-2 hover:bg-accent">
                  <button onClick={() => loadRoute(r)} className="flex-1 text-left">
                    <div className="text-sm font-semibold truncate">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.kind} · {r.waypoints.length} จุด · {new Date(r.updated_at).toLocaleDateString()}
                      {r.is_shared && " · shared"}
                    </div>
                  </button>
                  <button
                    onClick={() => confirm(`ลบ "${r.name}" ?`) && deleteRouteMut.mutate(r.id)}
                    className="p-1 hover:bg-background rounded text-red-600"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Sheet>
      )}
      {locOpen && (
        <Sheet title="ต้นทาง Default" onClose={() => setLocOpen(false)}>
          <div className="max-h-[240px] overflow-y-auto divide-y border rounded-md">
            {savedLocations.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">ยังไม่มีต้นทางบันทึกไว้</div>
            ) : (
              savedLocations.map((l) => (
                <div key={l.id} className="p-2 flex items-center gap-2 hover:bg-accent">
                  <button onClick={() => useSavedLocation(l)} className="flex-1 text-left">
                    <div className="text-sm font-semibold truncate flex items-center gap-1">
                      {l.name}
                      {l.is_shared && <span className="text-[10px] px-1 py-0.5 rounded bg-blue-100 text-blue-700">shared</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{l.address ?? `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`}</div>
                  </button>
                  <button onClick={() => confirm(`ลบ "${l.name}" ?`) && deleteLocMut.mutate(l.id)} className="p-1 hover:bg-background rounded text-red-600">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="border-t pt-3 space-y-2">
            <div className="text-xs font-semibold flex items-center gap-1"><Plus className="size-3.5" /> บันทึกต้นทางใหม่</div>
            <div className="text-[11px] text-muted-foreground">
              พิกัด: {pendingOriginLatLng ? `${pendingOriginLatLng.lat.toFixed(5)}, ${pendingOriginLatLng.lng.toFixed(5)}` : origin ? `${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}` : "— ปักบนแผนที่ก่อน (ปุ่ม Pick Origin)"}
            </div>
            <input value={newLocName} onChange={(e) => setNewLocName(e.target.value)} placeholder="ชื่อ (เช่น สำนักงานใหญ่)" className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
            <input value={newLocAddr} onChange={(e) => setNewLocAddr(e.target.value)} placeholder="ที่อยู่ (ไม่จำเป็น)" className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={newLocShared} onChange={(e) => setNewLocShared(e.target.checked)} />
              แชร์ให้ทุกคน (admin เท่านั้น)
            </label>
            <div className="flex justify-end">
              <button
                onClick={() => {
                  const pt = pendingOriginLatLng ?? (origin ? { lat: origin.lat, lng: origin.lng } : null);
                  if (!pt) return;
                  saveLocMut.mutate(pt);
                }}
                disabled={saveLocMut.isPending || (!pendingOriginLatLng && !origin) || !newLocName.trim()}
                className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs inline-flex items-center gap-1 disabled:opacity-40"
              >
                {saveLocMut.isPending && <Loader2 className="size-3.5 animate-spin" />} บันทึก
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[1000] bg-background p-3 flex flex-col gap-2 overflow-auto">
        {toolbar}
        {modeBar}
        {routeInfoBar}
        {mapAndPanel}
        {savedDialogs}
        {analyticsAsset && (
          <Suspense fallback={null}>
            <BillboardAnalyticsPanel asset={analyticsAsset} onClose={() => setAnalyticsAsset(null)} />
          </Suspense>
        )}
      </div>
    );
  }


  return (
    <div className="space-y-3">
      <PageHeader
        title="Asset Map"
        subtitle="Corridor: วาดเส้นทาง · Inspection: วางแผนตรวจสื่อ (OSRM) · POI Search: หาป้ายใกล้ห้าง/โชว์รูม/BTS (Overpass)"
      />
      {toolbar}
      {modeBar}
      {routeInfoBar}
      {mapAndPanel}
      {savedDialogs}
      {analyticsAsset && (
        <Suspense fallback={null}>
          <BillboardAnalyticsPanel asset={analyticsAsset} onClose={() => setAnalyticsAsset(null)} />
        </Suspense>
      )}
    </div>

  );
}

function panelStyle(fullscreen: boolean): React.CSSProperties {
  return fullscreen ? { height: "calc(100vh - 200px)" } : { height: "calc(100vh - 280px)", minHeight: 480 };
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

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[1200] bg-black/40 flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} className="bg-card border rounded-xl shadow-xl w-full max-w-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">{title}</div>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
