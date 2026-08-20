// Pure geospatial planning helpers — no AI, no network, no credits.

export type PlanRisk = "high" | "medium" | "low";

export type PlanPoint = {
  id: string;
  code: string;
  name: string | null;
  department: string | null;
  mediaType: string | null;
  province?: string | null;
  lat: number;
  lng: number;
  /** Phase 5 — pre-computed risk level from `asset_risk_scores`. */
  risk?: PlanRisk | null;
  riskScore?: number | null;
};

export const RISK_WEIGHT: Record<PlanRisk, number> = { high: 3, medium: 1, low: 0 };

/** Risk pressure of a batch: high-risk assets count most. */
export function riskPressure(points: PlanPoint[]): number {
  let s = 0;
  for (const p of points) s += RISK_WEIGHT[p.risk ?? "low"] ?? 0;
  return s;
}

/**
 * Front-load risk: keep each day's geography and workload exactly as clustered,
 * but visit the day-batches that contain the most high-risk assets first.
 */
export function sortDaysByRisk(batches: PlanPoint[][]): PlanPoint[][] {
  return batches
    .map((pts, i) => ({ pts, i, pressure: riskPressure(pts) }))
    .sort((a, b) => b.pressure - a.pressure || a.i - b.i)
    .map((x) => x.pts);
}



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

// ---------------------------------------------------------------------------
// Workload-balanced clustering
// ---------------------------------------------------------------------------

/** Plain k-means (k-means++ style seeding, no capacity pass). */
function kmeansGeo(
  points: PlanPoint[],
  k: number,
  iterations = 30,
): { assign: number[]; centers: Array<{ lat: number; lng: number }> } {
  const rand = mulberry32(points.length * 7919 + k);
  const centers: Array<{ lat: number; lng: number }> = [{ lat: points[0].lat, lng: points[0].lng }];
  while (centers.length < k) {
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

  const assign = new Array<number>(points.length).fill(0);
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
  return { assign, centers };
}

/**
 * Cluster points into `k` groups whose *workload* (not raw count) is balanced.
 * `weight` returns the workload of one point (e.g. service minutes).
 * Transfers always pick the point that is geographically cheapest to move,
 * so zones stay contiguous while loads even out. Runs until convergence
 * (bounded by point count) instead of a fixed small number of passes.
 */
export function clusterBalanced(
  points: PlanPoint[],
  k: number,
  weight: (p: PlanPoint) => number = () => 1,
  tolerance = 0.08,
): Cluster[] {
  const kk = Math.max(1, Math.min(k, Math.max(1, points.length)));
  if (points.length === 0) {
    return Array.from({ length: kk }, (_, i) => ({
      index: i,
      center: { lat: 0, lng: 0 },
      points: [],
    }));
  }
  if (kk === 1) return [{ index: 0, center: centroid(points), points: [...points] }];

  const { assign, centers } = kmeansGeo(points, kk, 30);
  const buckets: number[][] = Array.from({ length: kk }, () => []);
  points.forEach((_, i) => buckets[assign[i]].push(i));

  const w = points.map((p) => Math.max(0.0001, weight(p)));
  const load = buckets.map((b) => b.reduce((s, i) => s + w[i], 0));
  const total = load.reduce((s, x) => s + x, 0);
  const target = total / kk;
  const limit = Math.max(300, points.length * 4);

  for (let move = 0; move < limit; move++) {
    let hi = 0;
    let lo = 0;
    for (let c = 0; c < kk; c++) {
      if (load[c] > load[hi]) hi = c;
      if (load[c] < load[lo]) lo = c;
    }
    const diff = load[hi] - load[lo];
    if (diff <= Math.max(tolerance * target, 1e-6)) break;
    if (buckets[hi].length === 0) break;

    // Cheapest point to hand over: closest to the receiving centre, and small
    // enough that the transfer actually reduces the gap.
    let bestIdx = -1;
    let bestCost = Infinity;
    for (const i of buckets[hi]) {
      if (w[i] >= diff) continue;
      const cost = haversineM(points[i], centers[lo]) - haversineM(points[i], centers[hi]);
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;

    buckets[hi] = buckets[hi].filter((i) => i !== bestIdx);
    buckets[lo].push(bestIdx);
    load[hi] -= w[bestIdx];
    load[lo] += w[bestIdx];
    for (const c of [hi, lo]) {
      const m = buckets[c].map((i) => points[i]);
      if (m.length) centers[c] = centroid(m);
    }
  }

  return buckets.map((b, i) => {
    const pts = b.map((idx) => points[idx]);
    return { index: i, center: pts.length ? centroid(pts) : centers[i], points: pts };
  });
}

/**
 * Travel-aware balancing: equalise *total working hours* (inspection time plus
 * estimated driving time) rather than inspection time alone, so a zone that is
 * spread out gets fewer assets than a dense one. Works by re-weighting each
 * zone's points by its own travel overhead and re-clustering a few rounds.
 */
export function clusterFairHours(
  points: PlanPoint[],
  k: number,
  serviceMinutes: (p: PlanPoint) => number,
  speedKmh: number,
  rounds = 3,
): Cluster[] {
  const kk = Math.max(1, Math.min(k, Math.max(1, points.length)));
  if (points.length === 0 || kk === 1) return clusterBalanced(points, kk, serviceMinutes);

  const speed = Math.max(5, speedKmh);
  let factors = new Map<string, number>(); // point id -> overhead multiplier
  let clusters = clusterBalanced(points, kk, serviceMinutes);

  for (let r = 0; r < Math.max(1, rounds); r++) {
    const next = new Map<string, number>();
    for (const c of clusters) {
      if (c.points.length === 0) continue;
      const svcMin = c.points.reduce((s, p) => s + Math.max(0.1, serviceMinutes(p)), 0);
      const driveMin = (estimateTourMeters(c.points, c.center) / 1000 / speed) * 60;
      const f = (svcMin + driveMin) / svcMin; // >= 1
      for (const p of c.points) next.set(p.id, f);
    }
    factors = next;
    if (r === rounds - 1) break;
    clusters = clusterBalanced(
      points,
      kk,
      (p) => Math.max(0.1, serviceMinutes(p)) * (factors.get(p.id) ?? 1),
    );
  }
  return clusters;
}

/** Split one inspector's assets into `days` batches with balanced workload. */

export function splitIntoDaysBalanced(
  points: PlanPoint[],
  days: number,
  weight: (p: PlanPoint) => number = () => 1,
): PlanPoint[][] {
  const d = Math.max(1, days);
  if (points.length === 0) return Array.from({ length: d }, () => []);
  if (d === 1) return [[...points]];
  const clusters = clusterBalanced(points, d, weight);
  // Order days west→east-ish (by centre longitude) so consecutive days are near
  // each other geographically instead of "biggest first".
  const sorted = clusters
    .slice()
    .sort((a, b) => a.center.lng - b.center.lng || a.center.lat - b.center.lat)
    .map((c) => c.points);
  while (sorted.length < d) sorted.push([]);
  return sorted;
}

/** Day split that equalises inspection + driving hours (travel-fair mode). */
export function splitIntoDaysFair(
  points: PlanPoint[],
  days: number,
  serviceMinutes: (p: PlanPoint) => number,
  speedKmh: number,
): PlanPoint[][] {
  const d = Math.max(1, days);
  if (points.length === 0) return Array.from({ length: d }, () => []);
  if (d === 1) return [[...points]];
  const sorted = clusterFairHours(points, d, serviceMinutes, speedKmh)
    .slice()
    .sort((a, b) => a.center.lng - b.center.lng || a.center.lat - b.center.lat)
    .map((c) => c.points);
  while (sorted.length < d) sorted.push([]);
  return sorted;
}


/**
 * Allocate `total` staff across groups proportionally to workload using the
 * largest-remainder method, so a 1,200-asset province never gets the same
 * head-count as a 2-asset one. Groups only get 0 when staff run out.
 */
export function allocateProportional(weights: number[], total: number): number[] {
  const n = weights.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0 || total <= 0) return out;
  const sum = weights.reduce((s, x) => s + x, 0);
  if (sum <= 0) return out;

  if (total <= n) {
    // Not enough staff for one each — give them to the heaviest groups.
    const order = weights
      .map((wv, i) => ({ wv, i }))
      .sort((a, b) => b.wv - a.wv)
      .slice(0, total);
    for (const o of order) out[o.i] = 1;
    return out;
  }

  const quota = weights.map((wv) => (wv / sum) * total);
  let used = 0;
  for (let i = 0; i < n; i++) {
    out[i] = Math.max(1, Math.floor(quota[i]));
    used += out[i];
  }
  // Trim if the "at least 1" rule overshot: take from the largest allocations.
  while (used > total) {
    let bi = -1;
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      if (out[i] <= 1) continue;
      const over = out[i] - quota[i];
      if (over > best) {
        best = over;
        bi = i;
      }
    }
    if (bi === -1) break;
    out[bi] -= 1;
    used -= 1;
  }
  // Hand out the remainder to the largest fractional parts.
  while (used < total) {
    let bi = 0;
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      const rem = quota[i] - out[i];
      if (rem > best) {
        best = rem;
        bi = i;
      }
    }
    out[bi] += 1;
    used += 1;
  }
  return out;
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

// ---------------------------------------------------------------------------
// Phase A — real daily hour cap + automatic low-risk trimming
// ---------------------------------------------------------------------------

export type TrimResult = {
  /** points that stay in the day (ordered as given) */
  kept: PlanPoint[];
  /** points pushed out of the day because the cap was exceeded */
  dropped: PlanPoint[];
};

/**
 * Trim a day-batch until its estimated working hours fit `capHours`.
 * Only Low (then Medium) risk assets are removed, lowest risk score first,
 * so high-risk inspections are never sacrificed. `hoursOf` recomputes the
 * day's hours for a candidate subset (service + driving estimate).
 * Points whose code is in `pinned` are never dropped (catch-up queue).
 */
export function trimToHourCap(
  points: PlanPoint[],
  capHours: number,
  hoursOf: (pts: PlanPoint[]) => number,
  pinned: Set<string> = new Set(),
): TrimResult {
  const cap = Math.max(0.5, capHours);
  let kept = [...points];
  const dropped: PlanPoint[] = [];
  if (hoursOf(kept) <= cap) return { kept, dropped };

  const droppableOrder = (p: PlanPoint) => {
    if (pinned.has(p.code)) return -1; // never drop
    const lvl = p.risk ?? "low";
    if (lvl === "high") return -1;
    return lvl === "low" ? 0 : 1; // low first, then medium
  };

  const candidates = kept
    .map((p, i) => ({ p, i, tier: droppableOrder(p) }))
    .filter((c) => c.tier >= 0)
    .sort((a, b) => a.tier - b.tier || (a.p.riskScore ?? 0) - (b.p.riskScore ?? 0));

  for (const c of candidates) {
    if (hoursOf(kept) <= cap) break;
    kept = kept.filter((p) => p.id !== c.p.id);
    dropped.push(c.p);
  }
  return { kept, dropped };
}

/**
 * Put previously deferred assets (catch-up queue) at the front of the list so
 * the next plan visits them first. Order inside each group is preserved.
 */
export function prioritizeFirst(points: PlanPoint[], pinnedCodes: Set<string>): PlanPoint[] {
  if (pinnedCodes.size === 0) return points;
  const first: PlanPoint[] = [];
  const rest: PlanPoint[] = [];
  for (const p of points) (pinnedCodes.has(p.code) ? first : rest).push(p);
  return [...first, ...rest];
}
