// Pure geospatial planning helpers — no AI, no network, no credits.

export type PlanPoint = {
  id: string;
  code: string;
  name: string | null;
  department: string | null;
  mediaType: string | null;
  province?: string | null;
  lat: number;
  lng: number;
};


export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Deterministic PRNG so re-running the same plan gives the same zones.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Cluster = {
  index: number;
  center: { lat: number; lng: number };
  points: PlanPoint[];
};

/**
 * K-Means on lat/lng (equirectangular projection) followed by a capacity
 * balancing pass so every inspector gets a similar workload.
 */
export function balancedKMeans(points: PlanPoint[], k: number, iterations = 25): Cluster[] {
  const kk = Math.max(1, Math.min(k, points.length || 1));
  if (points.length === 0) {
    return Array.from({ length: kk }, (_, i) => ({
      index: i,
      center: { lat: 0, lng: 0 },
      points: [],
    }));
  }
  if (kk === 1) {
    return [{ index: 0, center: centroid(points), points: [...points] }];
  }

  const rand = mulberry32(points.length * 7919 + kk);
  // k-means++ style seeding
  const centers: Array<{ lat: number; lng: number }> = [];
  centers.push({ lat: points[0].lat, lng: points[0].lng });
  while (centers.length < kk) {
    let best: PlanPoint | null = null;
    let bestD = -1;
    for (const p of points) {
      let d = Infinity;
      for (const c of centers) d = Math.min(d, haversineM(p, c));
      const jitter = 0.9 + rand() * 0.2;
      if (d * jitter > bestD) {
        bestD = d * jitter;
        best = p;
      }
    }
    centers.push({ lat: best!.lat, lng: best!.lng });
  }

  let assign = new Array<number>(points.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = haversineM(points[i], centers[c]);
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      if (assign[i] !== bi) {
        assign[i] = bi;
        moved = true;
      }
    }
    for (let c = 0; c < centers.length; c++) {
      const members = points.filter((_, i) => assign[i] === c);
      if (members.length) centers[c] = centroid(members);
    }
    if (!moved) break;
  }

  // ---- capacity balancing ----
  const cap = Math.ceil(points.length / kk);
  const buckets: number[][] = Array.from({ length: kk }, () => []);
  points.forEach((_, i) => buckets[assign[i]].push(i));

  for (let pass = 0; pass < 12; pass++) {
    const over = buckets.findIndex((b) => b.length > cap);
    if (over === -1) break;
    const under = buckets.reduce(
      (acc, b, i) => (b.length < buckets[acc].length ? i : acc),
      0,
    );
    if (buckets[under].length >= cap) break;
    // move the point of `over` that is closest to the `under` center
    let bestIdx = -1;
    let bestD = Infinity;
    for (const i of buckets[over]) {
      const d = haversineM(points[i], centers[under]);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    buckets[over] = buckets[over].filter((i) => i !== bestIdx);
    buckets[under].push(bestIdx);
    const m = buckets[under].map((i) => points[i]);
    if (m.length) centers[under] = centroid(m);
  }

  assign = new Array<number>(points.length).fill(0);
  buckets.forEach((b, c) => b.forEach((i) => (assign[i] = c)));

  return buckets.map((b, i) => {
    const pts = b.map((idx) => points[idx]);
    return { index: i, center: pts.length ? centroid(pts) : centers[i], points: pts };
  });
}

export function centroid(points: Array<{ lat: number; lng: number }>) {
  let la = 0;
  let ln = 0;
  for (const p of points) {
    la += p.lat;
    ln += p.lng;
  }
  return { lat: la / points.length, lng: ln / points.length };
}

/** Rough straight-line tour length (m) using nearest-neighbour ordering. */
export function estimateTourMeters(points: PlanPoint[], start?: { lat: number; lng: number }): number {
  if (points.length < 2) return 0;
  const remaining = [...points];
  let cur: { lat: number; lng: number } = start ?? remaining[0];
  let total = 0;
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
    total += bd;
    cur = remaining[bi];
    remaining.splice(bi, 1);
  }
  return total;
}

/** Split one inspector's assets into N day-batches by spatial proximity. */
export function splitIntoDays(points: PlanPoint[], days: number): PlanPoint[][] {
  const d = Math.max(1, days);
  if (points.length === 0) return Array.from({ length: d }, () => []);
  if (d === 1) return [[...points]];
  return balancedKMeans(points, d)
    .map((c) => c.points)
    .sort((a, b) => b.length - a.length);
}

export const CLUSTER_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f97316",
  "#a855f7",
  "#dc2626",
  "#0891b2",
  "#ca8a04",
  "#db2777",
  "#4f46e5",
  "#059669",
];
