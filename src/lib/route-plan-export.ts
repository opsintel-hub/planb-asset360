// Phase 4 — plan persistence payload + CSV/GPX/KML exports.
// Everything here is pure string/math work: no AI, no paid API, zero credits.

import { buildGpx, buildKml, downloadText, type ExportWaypoint, type LatLng } from "./osrm";
import type { PlanPoint } from "./route-planner";
import type { DayRoute } from "./route-osrm";

export type SavedPlanDay = {
  day: number;
  meters: number;
  hours: number;
  points: PlanPoint[];
};

export type SavedPlanInspector = {
  index: number;
  color: string;
  center: { lat: number; lng: number };
  days: SavedPlanDay[];
};

export type SavedPlanPayload = {
  v: 1;
  filters: {
    projects: string[];
    medias: string[];
    regions: string[];
    provinces: string[];
    lockProvince: boolean;
  };
  resources: { inspectors: number; days: number; emergency: boolean; absent: number };
  work: {
    minutesPerAsset: number;
    speedKmh: number;
    dailyHours: number;
    mediaMinutes: Record<string, number>;
  };
  depot: {
    startMode: string;
    startPoint: { lat: number; lng: number; name: string } | null;
    endMode: string;
    endPoint: { lat: number; lng: number; name: string } | null;
  };
  plan: SavedPlanInspector[];
};

/** The whole plan travels inside the existing `notes` column as JSON. */
export function encodePlan(payload: SavedPlanPayload): string {
  return JSON.stringify(payload);
}

export function decodePlan(notes: string | null): SavedPlanPayload | null {
  if (!notes) return null;
  try {
    const p = JSON.parse(notes) as SavedPlanPayload;
    if (!p || p.v !== 1 || !Array.isArray(p.plan)) return null;
    return p;
  } catch {
    return null;
  }
}

// ---------- CSV ----------

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER = [
  "พนักงาน",
  "วันที่",
  "ลำดับ",
  "รหัสป้าย",
  "ชื่อป้าย",
  "ประเภทสื่อ",
  "แผนก",
  "จังหวัด",
  "Latitude",
  "Longitude",
  "ระยะจากจุดก่อน (กม.)",
  "เวลาขับ (นาที)",
  "เวลาตรวจ (นาที)",
  "ระยะสะสม (กม.)",
];

export type CsvDaySource = {
  inspector: number;
  day: number;
  points: PlanPoint[];
  /** when present, ordering + distances come from the real OSRM route */
  route?: DayRoute | null;
};

export function buildPlanCsv(
  sources: CsvDaySource[],
  minutesFor: (p: PlanPoint) => number,
): string {
  const lines = [CSV_HEADER.join(",")];
  for (const src of sources) {
    const stops = src.route?.stops?.length
      ? src.route.stops.map((s) => ({
          point: s.point,
          seq: s.seq,
          legKm: s.legMeters / 1000,
          driveMin: s.legSeconds / 60,
          cumKm: s.cumMeters / 1000,
        }))
      : src.points.map((p, i) => ({
          point: p,
          seq: i + 1,
          legKm: null as number | null,
          driveMin: null as number | null,
          cumKm: null as number | null,
        }));
    for (const s of stops) {
      lines.push(
        [
          `คนที่ ${src.inspector}`,
          src.day,
          s.seq,
          s.point.code,
          s.point.name ?? "",
          s.point.mediaType ?? "",
          s.point.department ?? "",
          s.point.province ?? "",
          s.point.lat,
          s.point.lng,
          s.legKm == null ? "" : s.legKm.toFixed(2),
          s.driveMin == null ? "" : Math.round(s.driveMin),
          Math.round(minutesFor(s.point)),
          s.cumKm == null ? "" : s.cumKm.toFixed(2),
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return "\uFEFF" + lines.join("\n");
}

export function downloadCsv(filename: string, content: string) {
  downloadText(filename, "text/csv;charset=utf-8", content);
}

// ---------- GPX / KML ----------

export function planWaypoints(
  points: PlanPoint[],
  route?: DayRoute | null,
): ExportWaypoint[] {
  const list = route?.stops?.length ? route.stops.map((s) => s.point) : points;
  return list.map((p, i) => ({
    lat: p.lat,
    lng: p.lng,
    name: `${i + 1}. ${p.code}`,
    description: [p.name, p.mediaType, p.province].filter(Boolean).join(" · ") || undefined,
  }));
}

export function planTrack(points: PlanPoint[], route?: DayRoute | null): LatLng[] {
  if (route && route.geometry.length > 1) return route.geometry;
  const list = route?.stops?.length ? route.stops.map((s) => s.point) : points;
  return list.map((p) => [p.lat, p.lng] as LatLng);
}

export function downloadDayGpx(
  name: string,
  points: PlanPoint[],
  route?: DayRoute | null,
) {
  downloadText(
    `${name}.gpx`,
    "application/gpx+xml",
    buildGpx(name, planTrack(points, route), planWaypoints(points, route)),
  );
}

export function downloadDayKml(
  name: string,
  points: PlanPoint[],
  route?: DayRoute | null,
) {
  downloadText(
    `${name}.kml`,
    "application/vnd.google-earth.kml+xml",
    buildKml(name, planTrack(points, route), planWaypoints(points, route)),
  );
}
