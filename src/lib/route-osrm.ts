// Phase 3 — real road routing + TSP ordering via the public OSRM demo server.
// No AI, no paid API: OSRM is free. We only limit request volume by chunking,
// caching per day-plan and reusing the results for exports/preview.

import { osrmRoute, osrmTrip, type LatLng, type OsrmLeg } from "./osrm";
import { haversineM, type PlanPoint } from "./route-planner";

/** OSRM public demo accepts ~100 coordinates per request; stay well below. */
const TRIP_CHUNK = 60;
const ROUTE_CHUNK = 90;

export type RouteStop = {
  point: PlanPoint;
  /** 1-based visiting order */
  seq: number;
  /** distance from the previous stop (meters) */
  legMeters: number;
  /** driving time from the previous stop (seconds) */
  legSeconds: number;
  /** cumulative distance from the origin (meters) */
  cumMeters: number;
  /** cumulative driving time from the origin (seconds) */
  cumSeconds: number;
};

export type DayRoute = {
  stops: RouteStop[];
  geometry: LatLng[];
  totalMeters: number;
  totalSeconds: number;
  /** true when OSRM was unreachable and we fell back to straight-line math */
  approximate: boolean;
};

/** Greedy nearest-neighbour pre-order so chunks stay geographically coherent. */
function nearestNeighbourOrder(points: PlanPoint[], start: { lat: number; lng: number }): PlanPoint[] {
  const remaining = [...points];
  const out: PlanPoint[] = [];
  let cur = start;
  while (remaining.length) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineM(cur, remaining[i]);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    const next = remaining.splice(bi, 1)[0];
    out.push(next);
    cur = next;
  }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Optimise the visiting order of one day's assets with OSRM /trip.
 * Large days are solved chunk-by-chunk (each chunk starts where the previous
 * one ended) which keeps request size legal and still yields a sane tour.
 */
async function optimiseOrder(
  points: PlanPoint[],
  origin: { lat: number; lng: number },
): Promise<{ ordered: PlanPoint[]; usedOsrm: boolean }> {
  const pre = nearestNeighbourOrder(points, origin);
  if (pre.length < 3) return { ordered: pre, usedOsrm: false };

  const ordered: PlanPoint[] = [];
  let anchor: { lat: number; lng: number } = origin;
  let usedOsrm = false;

  for (const group of chunk(pre, TRIP_CHUNK)) {
    if (group.length < 3) {
      ordered.push(...group);
      if (group.length) anchor = group[group.length - 1];
      continue;
    }
    try {
      const coords: LatLng[] = [
        [anchor.lat, anchor.lng],
        ...group.map((p) => [p.lat, p.lng] as LatLng),
      ];
      const trip = await osrmTrip(coords, { roundtrip: false, fixedStart: true });
      // waypointOrder[i] = visiting position of input i (0 = the anchor)
      const seq = group
        .map((p, i) => ({ p, order: trip.waypointOrder[i + 1] ?? i + 1 }))
        .sort((a, b) => a.order - b.order)
        .map((x) => x.p);
      ordered.push(...seq);
      anchor = seq[seq.length - 1];
      usedOsrm = true;
    } catch {
      ordered.push(...group);
      anchor = group[group.length - 1];
    }
  }
  return { ordered, usedOsrm };
}

/** Fetch road geometry + per-leg distance/time for an ordered stop list. */
async function legsFor(
  ordered: PlanPoint[],
  origin: { lat: number; lng: number },
): Promise<{ legs: OsrmLeg[]; geometry: LatLng[]; ok: boolean }> {
  const path: LatLng[] = [[origin.lat, origin.lng], ...ordered.map((p) => [p.lat, p.lng] as LatLng)];
  if (path.length < 2) return { legs: [], geometry: [], ok: false };

  const legs: OsrmLeg[] = [];
  const geometry: LatLng[] = [];
  let ok = true;

  // Overlapping chunks so consecutive segments stay connected.
  for (let start = 0; start < path.length - 1; start += ROUTE_CHUNK - 1) {
    const slice = path.slice(start, start + ROUTE_CHUNK);
    if (slice.length < 2) break;
    try {
      const r = await osrmRoute(slice);
      legs.push(...r.legs);
      geometry.push(...r.geometry);
    } catch {
      ok = false;
      for (let i = 0; i < slice.length - 1; i++) {
        const m = haversineM(
          { lat: slice[i][0], lng: slice[i][1] },
          { lat: slice[i + 1][0], lng: slice[i + 1][1] },
        ) * 1.3; // road detour factor
        legs.push({ distance: m, duration: m / (22_000 / 3600) });
      }
      geometry.push(...slice);
    }
  }
  return { legs, geometry, ok };
}

/** Full Phase-3 computation for one inspector-day. */
export async function computeDayRoute(
  points: PlanPoint[],
  origin: { lat: number; lng: number },
): Promise<DayRoute> {
  if (points.length === 0) {
    return { stops: [], geometry: [], totalMeters: 0, totalSeconds: 0, approximate: false };
  }
  const { ordered, usedOsrm } = await optimiseOrder(points, origin);
  const { legs, geometry, ok } = await legsFor(ordered, origin);

  let cumM = 0;
  let cumS = 0;
  const stops: RouteStop[] = ordered.map((p, i) => {
    const leg = legs[i] ?? { distance: 0, duration: 0 };
    cumM += leg.distance;
    cumS += leg.duration;
    return {
      point: p,
      seq: i + 1,
      legMeters: leg.distance,
      legSeconds: leg.duration,
      cumMeters: cumM,
      cumSeconds: cumS,
    };
  });

  return {
    stops,
    geometry,
    totalMeters: cumM,
    totalSeconds: cumS,
    approximate: !ok || (!usedOsrm && points.length >= 3),
  };
}

export function fmtKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} กม.`;
}

export function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  return `${h} ชม. ${m % 60} นาที`;
}
