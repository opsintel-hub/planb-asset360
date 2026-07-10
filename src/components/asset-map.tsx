import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import type { MapAsset } from "@/lib/map.functions";

// Department -> hex color
const DEPT_COLORS: Record<string, string> = {
  "Operation 7-Eleven": "#ef4444",
  "Airport Media": "#3b82f6",
  "Airport Static Media": "#60a5fa",
  "Airport Digital Network": "#1d4ed8",
  "Billboard Media": "#f97316",
  "Digital Media": "#a855f7",
  "Digital Gateway X": "#7c3aed",
  Digital: "#c084fc",
  Static: "#14b8a6",
  "Static Media": "#0d9488",
  "Bus Media": "#eab308",
};
const DEFAULT_COLOR = "#6b7280";

function colorFor(dept: string | null): string {
  return (dept && DEPT_COLORS[dept]) || DEFAULT_COLOR;
}

function pinIcon(color: string, warning: boolean): L.DivIcon {
  const warn = warning
    ? `<div style="position:absolute;top:-6px;right:-6px;background:#facc15;color:#111;border-radius:9999px;width:16px;height:16px;display:grid;place-items:center;font-size:11px;font-weight:800;box-shadow:0 0 0 2px white;">!</div>`
    : "";
  const html = `
    <div style="position:relative;width:22px;height:30px;">
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

type Props = {
  assets: MapAsset[];
  claimedCodes: Set<string>;
};

export default function AssetMap({ assets, claimedCodes }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const [ready, setReady] = useState(false);

  // init once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [13.7563, 100.5018], // Bangkok
      zoom: 11,
      preferCanvas: true,
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
    setReady(true);

    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  // update markers when assets/claims change
  useEffect(() => {
    if (!ready) return;
    const cluster = clusterRef.current;
    const map = mapRef.current;
    if (!cluster || !map) return;
    cluster.clearLayers();

    const markers: L.Marker[] = [];
    for (const a of assets) {
      const warning = a.old_code ? claimedCodes.has(a.old_code) : false;
      const icon = pinIcon(colorFor(a.department), warning);
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
    }
    cluster.addLayers(markers);

    if (markers.length > 0) {
      const bounds = L.latLngBounds(markers.map((m) => m.getLatLng()));
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    }
  }, [assets, claimedCodes, ready]);

  const legendItems = useMemo(() => {
    const shown = new Set<string>();
    for (const a of assets) if (a.department) shown.add(a.department);
    return Array.from(shown).sort();
  }, [assets]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full rounded-lg overflow-hidden" />
      <div className="absolute bottom-3 right-3 z-[400] bg-white/95 dark:bg-slate-900/95 border rounded-lg shadow-md p-3 text-xs max-w-[240px] max-h-[50vh] overflow-y-auto">
        <div className="font-semibold mb-2">คำอธิบายสัญลักษณ์</div>
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-block w-4 h-4 rounded-full bg-yellow-400 text-[10px] font-bold grid place-items-center border">!</span>
          <span>กำลังซ่อม</span>
        </div>
        <div className="space-y-1">
          {legendItems.map((d) => (
            <div key={d} className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: colorFor(d) }} />
              <span className="truncate">{d}</span>
            </div>
          ))}
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
