import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import type { MapAsset } from "@/lib/map.functions";
import { projectForDepartment } from "@/lib/project-department-map";

export const PROJECT_COLORS: Record<string, string> = {
  "7-Eleven": "#ef4444",
  Airport: "#3b82f6",
  Billboard: "#f97316",
  Digital: "#a855f7",
  Static: "#14b8a6",
};
const DEFAULT_COLOR = "#6b7280";

export function projectColorFor(dept: string | null): string {
  const p = projectForDepartment(dept);
  return (p && PROJECT_COLORS[p]) || DEFAULT_COLOR;
}

function pinIcon(color: string, warning: boolean, dim: boolean): L.DivIcon {
  const warn = warning
    ? `<div style="position:absolute;top:-6px;right:-6px;background:#facc15;color:#111;border-radius:9999px;width:16px;height:16px;display:grid;place-items:center;font-size:11px;font-weight:800;box-shadow:0 0 0 2px white;">!</div>`
    : "";
  const opacity = dim ? 0.25 : 1;
  const html = `
    <div style="position:relative;width:22px;height:30px;opacity:${opacity};">
      <svg width="22" height="30" viewBox="0 0 22 30" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 0C4.9 0 0 4.9 0 11c0 8.2 11 19 11 19s11-10.8 11-19C22 4.9 17.1 0 11 0z" fill="${color}" stroke="white" stroke-width="1.5"/>
        <circle cx="11" cy="11" r="4" fill="white"/>
      </svg>
      ${warn}
    </div>`;
  return L.divIcon({
    html,
    className: "asset-pin",
    iconSize: [22, 30],
    iconAnchor: [11, 30],
    popupAnchor: [0, -28],
  });
}

function originIcon(): L.DivIcon {
  const html = `
    <div style="position:relative;width:28px;height:28px;">
      <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="14" r="12" fill="#22c55e" stroke="white" stroke-width="2"/>
        <path d="M14 6l2.4 5 5.6.8-4 3.9.9 5.5L14 18.5 9.1 21.2l.9-5.5-4-3.9 5.6-.8z" fill="white"/>
      </svg>
    </div>`;
  return L.divIcon({ html, className: "origin-pin", iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14] });
}

function waypointIcon(index: number): L.DivIcon {
  const html = `
    <div style="position:relative;width:26px;height:26px;">
      <svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg">
        <circle cx="13" cy="13" r="11" fill="#1d4ed8" stroke="white" stroke-width="2"/>
      </svg>
      <div style="position:absolute;inset:0;color:white;font-weight:700;font-size:12px;display:grid;place-items:center;">${index}</div>
    </div>`;
  return L.divIcon({ html, className: "wp-pin", iconSize: [26, 26], iconAnchor: [13, 13] });
}

type LatLng = [number, number];

export type PoiMarker = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  icon: string;
  color: string;
  categoryLabel?: string;
};

type Props = {
  assets: MapAsset[];
  claimedCodes: Set<string>;
  focusId?: string | null;
  drawMode?: boolean;
  polyline?: LatLng[];
  onPolylineChange?: (pts: LatLng[]) => void;
  radiusMeters?: number;
  nearbyIds?: Set<string> | null;
  // Phase 3 additions:
  roadPolyline?: LatLng[] | null; // actual road-following route (from OSRM)
  origin?: { lat: number; lng: number; name?: string } | null;
  onOriginPick?: (lat: number, lng: number) => void; // when originPickMode is on and user clicks map
  originPickMode?: boolean;
  showRadiusRings?: boolean; // default true; hide for inspection mode
  // Phase 4 — POI proximity mode:
  poiMarkers?: PoiMarker[];
  poiRadiusMeters?: number;
  focusPoiId?: string | null;
  onBboxChange?: (bbox: [south: number, west: number, north: number, east: number]) => void;
  // Phase 3 — Billboard Analytics: fires when user clicks a billboard marker.
  onSelectAsset?: (asset: MapAsset) => void;
};


export default function AssetMap({
  assets,
  claimedCodes,
  focusId,
  drawMode = false,
  polyline = [],
  onPolylineChange,
  radiusMeters = 200,
  nearbyIds = null,
  roadPolyline = null,
  origin = null,
  onOriginPick,
  originPickMode = false,
  showRadiusRings = true,
  poiMarkers = [],
  poiRadiusMeters = 0,
  focusPoiId = null,
  onBboxChange,
  onSelectAsset,
}: Props) {

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const markerByIdRef = useRef<Map<string, L.Marker>>(new Map());
  const drawLayerRef = useRef<L.LayerGroup | null>(null);
  const roadLayerRef = useRef<L.LayerGroup | null>(null);
  const originLayerRef = useRef<L.LayerGroup | null>(null);
  const poiLayerRef = useRef<L.LayerGroup | null>(null);
  const poiMarkerByIdRef = useRef<Map<string, L.Marker>>(new Map());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [13.7563, 100.5018],
      zoom: 11,
      preferCanvas: true,
      doubleClickZoom: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
      maxClusterRadius: 50,
    });
    map.addLayer(cluster);

    mapRef.current = map;
    clusterRef.current = cluster;
    roadLayerRef.current = L.layerGroup().addTo(map);
    drawLayerRef.current = L.layerGroup().addTo(map);
    originLayerRef.current = L.layerGroup().addTo(map);
    poiLayerRef.current = L.layerGroup().addTo(map);
    setReady(true);

    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      drawLayerRef.current = null;
      roadLayerRef.current = null;
      originLayerRef.current = null;
      poiLayerRef.current = null;
    };
  }, []);

  // Emit bbox changes (for POI search area)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !onBboxChange) return;
    const emit = () => {
      const b = map.getBounds();
      onBboxChange([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
    };
    emit();
    map.on("moveend", emit);
    return () => { map.off("moveend", emit); };
  }, [ready, onBboxChange]);

  // Map click interactions (draw mode / origin pick)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const container = map.getContainer();
    container.style.cursor = drawMode || originPickMode ? "crosshair" : "";

    if (!drawMode && !originPickMode) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      if (originPickMode && onOriginPick) {
        onOriginPick(e.latlng.lat, e.latlng.lng);
        return;
      }
      if (drawMode && onPolylineChange) {
        onPolylineChange([...polyline, [e.latlng.lat, e.latlng.lng]]);
      }
    };
    const onRightClick = (e: L.LeafletMouseEvent) => {
      e.originalEvent?.preventDefault?.();
      if (drawMode && polyline.length > 0 && onPolylineChange) onPolylineChange(polyline.slice(0, -1));
    };
    map.on("click", onClick);
    map.on("contextmenu", onRightClick);
    return () => {
      map.off("click", onClick);
      map.off("contextmenu", onRightClick);
      container.style.cursor = "";
    };
  }, [drawMode, originPickMode, polyline, onPolylineChange, onOriginPick, ready]);

  // Render waypoints (draggable) + radius buffer + straight lines
  useEffect(() => {
    const layer = drawLayerRef.current;
    if (!ready || !layer) return;
    layer.clearLayers();
    if (polyline.length === 0) return;

    // Radius rings — only if requested and no road polyline covers them
    if (showRadiusRings) {
      for (const [lat, lng] of polyline) {
        L.circle([lat, lng], {
          radius: radiusMeters,
          color: "#2563eb",
          weight: 1,
          fillColor: "#3b82f6",
          fillOpacity: 0.08,
        }).addTo(layer);
      }
    }

    // Draggable numbered waypoints
    polyline.forEach(([lat, lng], i) => {
      const m = L.marker([lat, lng], {
        icon: waypointIcon(i + 1),
        draggable: !!onPolylineChange,
      });
      m.on("dragend", () => {
        const ll = m.getLatLng();
        const next = polyline.slice();
        next[i] = [ll.lat, ll.lng];
        onPolylineChange?.(next);
      });
      // Right-click on waypoint deletes it
      m.on("contextmenu", (e: L.LeafletMouseEvent) => {
        e.originalEvent?.preventDefault?.();
        const next = polyline.slice();
        next.splice(i, 1);
        onPolylineChange?.(next);
      });
      m.addTo(layer);
    });

    // Straight guide polyline (shown when no road polyline)
    if (polyline.length >= 2 && (!roadPolyline || roadPolyline.length < 2)) {
      L.polyline(polyline, {
        color: "#1d4ed8",
        weight: 3,
        opacity: 0.7,
        dashArray: "6 6",
      }).addTo(layer);
    }
  }, [polyline, radiusMeters, ready, onPolylineChange, roadPolyline, showRadiusRings]);

  // Render road (OSRM) polyline
  useEffect(() => {
    const layer = roadLayerRef.current;
    if (!ready || !layer) return;
    layer.clearLayers();
    if (!roadPolyline || roadPolyline.length < 2) return;
    L.polyline(roadPolyline, {
      color: "#1d4ed8",
      weight: 5,
      opacity: 0.9,
    }).addTo(layer);
  }, [roadPolyline, ready]);

  // Render origin marker
  useEffect(() => {
    const layer = originLayerRef.current;
    if (!ready || !layer) return;
    layer.clearLayers();
    if (!origin) return;
    const m = L.marker([origin.lat, origin.lng], { icon: originIcon() });
    m.bindPopup(`<div style="font-weight:700;">${escapeHtml(origin.name ?? "ต้นทาง")}</div>`);
    m.addTo(layer);
  }, [origin, ready]);

  // Render POI markers + optional radius circles
  useEffect(() => {
    const layer = poiLayerRef.current;
    if (!ready || !layer) return;
    layer.clearLayers();
    poiMarkerByIdRef.current.clear();
    if (poiMarkers.length === 0) return;
    for (const p of poiMarkers) {
      const html = `
        <div style="position:relative;width:28px;height:28px;">
          <div style="position:absolute;inset:0;border-radius:9999px;background:${p.color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>
          <div style="position:absolute;inset:0;display:grid;place-items:center;font-size:14px;">${p.icon}</div>
        </div>`;
      const icon = L.divIcon({ html, className: "poi-pin", iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14] });
      const m = L.marker([p.lat, p.lng], { icon, zIndexOffset: 500 });
      const popup = `<div style="min-width:180px;font-size:12px;">
        <div style="font-weight:700;">${escapeHtml(p.name)}</div>
        <div style="color:#6b7280;">${escapeHtml(p.categoryLabel ?? "")}</div>
      </div>`;
      m.bindPopup(popup);
      m.addTo(layer);
      poiMarkerByIdRef.current.set(p.id, m);
      if (poiRadiusMeters > 0) {
        L.circle([p.lat, p.lng], {
          radius: poiRadiusMeters,
          color: p.color,
          weight: 1,
          fillColor: p.color,
          fillOpacity: 0.08,
        }).addTo(layer);
      }
    }
  }, [poiMarkers, poiRadiusMeters, ready]);

  // Focus a POI when requested
  useEffect(() => {
    if (!ready || !focusPoiId) return;
    const map = mapRef.current;
    const m = poiMarkerByIdRef.current.get(focusPoiId);
    if (!map || !m) return;
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 15), { animate: true });
    setTimeout(() => m.openPopup(), 200);
  }, [focusPoiId, ready, poiMarkers]);


  // Render asset markers
  useEffect(() => {
    if (!ready) return;
    const cluster = clusterRef.current;
    const map = mapRef.current;
    if (!cluster || !map) return;
    cluster.clearLayers();
    markerByIdRef.current.clear();

    const markers: L.Marker[] = [];
    for (const a of assets) {
      const warning = a.old_code ? claimedCodes.has(a.old_code) : false;
      const dim = nearbyIds ? !nearbyIds.has(a.id) : false;
      const icon = pinIcon(projectColorFor(a.department), warning, dim);
      const m = L.marker([a.lat, a.lng], { icon });
      const html = `
        <div style="min-width:220px;font-size:12px;">
          <div style="font-weight:700;font-size:13px;">${escapeHtml(a.old_code ?? "—")}</div>
          <div style="color:#6b7280;">${escapeHtml(a.name ?? "")}</div>
          <div style="margin-top:6px;display:grid;grid-template-columns:auto 1fr;gap:2px 8px;">
            <span style="color:#6b7280;">Department:</span><span>${escapeHtml(a.department ?? "—")}</span>
            <span style="color:#6b7280;">Media Type:</span><span>${escapeHtml(a.media_type ?? "—")}</span>
            <span style="color:#6b7280;">Location:</span><span>${escapeHtml(a.location ?? "—")}</span>
            <span style="color:#6b7280;">Status:</span><span>${escapeHtml(a.status ?? "—")}</span>
            ${warning ? '<span style="color:#b45309;grid-column:1/-1;margin-top:4px;font-weight:600;">⚠ กำลังซ่อม (มีเคลมเปิดอยู่)</span>' : ""}
          </div>
          ${a.old_code ? `<a href="/search?q=${encodeURIComponent(a.old_code)}" style="display:inline-block;margin-top:8px;color:#2563eb;text-decoration:underline;">ดูประวัติป้าย →</a>` : ""}
        </div>`;
      m.bindPopup(html);
      markers.push(m);
      markerByIdRef.current.set(a.id, m);
    }
    cluster.addLayers(markers);

    if (markers.length > 0 && !focusId && polyline.length === 0 && !roadPolyline) {
      const bounds = L.latLngBounds(markers.map((m) => m.getLatLng()));
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    }
  }, [assets, claimedCodes, ready, focusId, nearbyIds, polyline.length, roadPolyline]);

  // Focus a specific asset when requested
  useEffect(() => {
    if (!ready || !focusId) return;
    const map = mapRef.current;
    const cluster = clusterRef.current;
    const marker = markerByIdRef.current.get(focusId);
    if (!map || !cluster || !marker) return;
    map.setView(marker.getLatLng(), 17, { animate: true });
    setTimeout(() => {
      cluster.zoomToShowLayer(marker, () => marker.openPopup());
    }, 200);
  }, [focusId, ready, assets]);

  const legendItems = useMemo(() => {
    const shown = new Set<string>();
    for (const a of assets) {
      const p = projectForDepartment(a.department);
      if (p) shown.add(p);
    }
    return Array.from(shown).sort();
  }, [assets]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full rounded-lg overflow-hidden" />
      <div className="absolute bottom-3 right-3 z-[400] bg-white/95 dark:bg-slate-900/95 text-slate-900 dark:text-slate-100 border rounded-lg shadow-md p-3 text-xs max-w-[240px]">
        <div className="font-semibold mb-2">คำอธิบายสัญลักษณ์</div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="inline-block w-4 h-4 rounded-full bg-yellow-400 text-slate-900 text-[10px] font-bold grid place-items-center border">!</span>
          <span>กำลังซ่อม</span>
        </div>
        {origin && (
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-block w-4 h-4 rounded-full bg-green-500 border" />
            <span>ต้นทาง</span>
          </div>
        )}
        <div className="space-y-1">
          {legendItems.map((p) => (
            <div key={p} className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: PROJECT_COLORS[p] ?? DEFAULT_COLOR }} />
              <span className="truncate">{p}</span>
            </div>
          ))}
          {legendItems.length === 0 && <div className="opacity-60">—</div>}
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
