// POI presets + Overpass query helpers.
// Overpass API is a FREE OpenStreetMap query endpoint (no API key required).

export type POIPresetKey =
  | "mall"
  | "car_dealer"
  | "subway"
  | "bus_stop"
  | "school"
  | "university"
  | "hospital"
  | "fuel"
  | "hotel"
  | "cafe"
  | "restaurant"
  | "bank"
  | "market"
  | "park"
  | "convenience";

export type POIPreset = {
  key: POIPresetKey;
  label: string;
  icon: string;
  color: string;
  // Each filter is a set of [k, v] pairs meaning k=v (OR across filters).
  tags: Array<Array<[string, string]>>;
};

export const POI_PRESETS: POIPreset[] = [
  { key: "mall", label: "ห้างสรรพสินค้า", icon: "🏬", color: "#a855f7",
    tags: [[["shop", "mall"]], [["shop", "department_store"]]] },
  { key: "car_dealer", label: "โชว์รูมรถยนต์", icon: "🚗", color: "#ef4444",
    tags: [[["shop", "car"]]] },
  { key: "subway", label: "รถไฟฟ้า BTS/MRT", icon: "🚇", color: "#0ea5e9",
    tags: [[["railway", "station"]], [["station", "subway"]]] },
  { key: "bus_stop", label: "ป้ายรถเมล์", icon: "🚌", color: "#f59e0b",
    tags: [[["highway", "bus_stop"]]] },
  { key: "school", label: "โรงเรียน", icon: "🏫", color: "#3b82f6",
    tags: [[["amenity", "school"]]] },
  { key: "university", label: "มหาวิทยาลัย", icon: "🎓", color: "#6366f1",
    tags: [[["amenity", "university"]], [["amenity", "college"]]] },
  { key: "hospital", label: "โรงพยาบาล", icon: "🏥", color: "#dc2626",
    tags: [[["amenity", "hospital"]]] },
  { key: "fuel", label: "ปั๊มน้ำมัน", icon: "⛽", color: "#f97316",
    tags: [[["amenity", "fuel"]]] },
  { key: "hotel", label: "โรงแรม", icon: "🏨", color: "#0891b2",
    tags: [[["tourism", "hotel"]]] },
  { key: "cafe", label: "ร้านกาแฟ", icon: "☕", color: "#a16207",
    tags: [[["amenity", "cafe"]]] },
  { key: "restaurant", label: "ร้านอาหาร", icon: "🍽️", color: "#e11d48",
    tags: [[["amenity", "restaurant"]]] },
  { key: "bank", label: "ธนาคาร", icon: "🏦", color: "#16a34a",
    tags: [[["amenity", "bank"]]] },
  { key: "market", label: "ตลาด", icon: "🛒", color: "#ca8a04",
    tags: [[["amenity", "marketplace"]]] },
  { key: "park", label: "สวนสาธารณะ", icon: "🌳", color: "#059669",
    tags: [[["leisure", "park"]]] },
  { key: "convenience", label: "ร้านสะดวกซื้อ", icon: "🏪", color: "#10b981",
    tags: [[["shop", "convenience"]]] },
];

export const PRESET_BY_KEY: Record<string, POIPreset> = Object.fromEntries(
  POI_PRESETS.map((p) => [p.key, p]),
);

export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

const OVERPASS_FETCH_TIMEOUT_MS = 24_000;
const OVERPASS_JSON_CACHE_TTL_MS = 10 * 60_000;
const OVERPASS_JSON_CACHE_MAX = 40;
const overpassJsonCache = new Map<string, { storedAt: number; payload: unknown }>();
const overpassJsonInflight = new Map<string, Promise<unknown>>();

function describeOverpassHttpError(status: number): string {
  if (status === 406) return "คำค้นถูก Overpass ปฏิเสธชั่วคราว";
  if (status === 429) return "Overpass จำกัดจำนวนการใช้งานชั่วคราว";
  if (status === 504 || status === 502 || status === 503) return "Overpass หนาแน่นหรือหมดเวลา";
  return `Overpass ตอบกลับ HTTP ${status}`;
}

function isRuntimeFailurePayload(payload: unknown, elapsedMs: number): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { elements?: unknown[]; remark?: string; osm3s?: { timestamp_osm_base?: string } };
  const remark = typeof p.remark === "string" ? p.remark : "";
  if (/runtime error|timeout|timed out|out of time|rate limit|too many requests/i.test(remark)) {
    return remark.slice(0, 180);
  }
  const timestamp = p.osm3s?.timestamp_osm_base;
  if (typeof timestamp === "string" && !/^\d{4}-\d{2}-\d{2}T/.test(timestamp)) {
    return `stale Overpass database (${timestamp})`;
  }
  if (!Array.isArray(p.elements)) {
    return "missing elements array";
  }
  // Some public Overpass instances can return HTTP 200 + an empty element list
  // when the query timed out. A genuinely empty small query usually returns fast.
  if (Array.isArray(p.elements) && p.elements.length === 0 && elapsedMs > 12_000) {
    return `empty response after ${(elapsedMs / 1000).toFixed(1)}s`;
  }
  return null;
}

/**
 * Fetch Overpass with headers required by public endpoints (User-Agent + Accept).
 * Falls back through mirrors on 4xx/5xx, timeout, and the common Overpass case
 * where a timed-out query returns HTTP 200 with an empty/error JSON payload.
 */
export async function fetchOverpass(query: string): Promise<Response> {
  const runAttempt = async (url: string) => {
    const startedAt = Date.now();
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Accept": "application/json",
      "User-Agent": "AssetHistory360/1.0 (contact: admin@example.com)",
    };

    const postBody = new URLSearchParams({ data: query }).toString();
    let resp = await fetch(url, {
      method: "POST",
      headers,
      body: postBody,
      signal: AbortSignal.timeout(OVERPASS_FETCH_TIMEOUT_MS),
    });
    // Some Overpass frontends intermittently reject encoded POST bodies with
    // HTTP 406 but accept the exact same query as a URL parameter.
    if (resp.status === 406) {
      resp = await fetch(`${url}?${postBody}`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(OVERPASS_FETCH_TIMEOUT_MS),
      });
    }
    if (!resp.ok) {
      throw new Error(describeOverpassHttpError(resp.status));
    }
    if (resp.ok) {
      const clone = resp.clone();
      try {
        const payload = await clone.json();
        const reason = isRuntimeFailurePayload(payload, Date.now() - startedAt);
        if (reason) {
          throw new Error(`Overpass mirror returned incomplete result: ${reason}`);
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("incomplete result")) throw e;
        throw new Error("Overpass ส่งข้อมูลกลับมาไม่ใช่ JSON");
      }
    }
    return resp;
  };

  let resolved = false;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const staggerMs = [0, 1800, 4200];
  const attempts = OVERPASS_ENDPOINTS.map((url, index) => new Promise<Response>((resolve, reject) => {
    const start = () => {
      if (resolved) return;
      runAttempt(url)
        .then((resp) => {
          resolved = true;
          for (const timer of timers) clearTimeout(timer);
          resolve(resp);
        })
        .catch(reject);
    };
    const delay = staggerMs[index] ?? index * 2500;
    if (delay === 0) start();
    else timers.push(setTimeout(start, delay));
  }));

  try {
    return await Promise.any(attempts);
  } catch (e) {
    const err = e as { errors?: unknown[]; message?: string };
    const messages = (err.errors ?? [])
      .filter((x): x is Error => x instanceof Error)
      .map((x) => x.message)
      .filter(Boolean);
    const detail = Array.from(new Set(messages)).slice(0, 2).join(" / ");
    throw new Error(`Overpass ไม่พร้อมใช้งานชั่วคราว${detail ? `: ${detail}` : ""}`);
  }
}

function cloneJson<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function fetchOverpassJson<T = OverpassResponse>(query: string): Promise<T> {
  const cached = overpassJsonCache.get(query);
  if (cached && Date.now() - cached.storedAt < OVERPASS_JSON_CACHE_TTL_MS) {
    return cloneJson<T>(cached.payload);
  }

  const inflight = overpassJsonInflight.get(query);
  if (inflight) {
    return cloneJson<T>(await inflight);
  }

  const promise = (async () => {
    const resp = await fetchOverpass(query);
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Overpass ${resp.status}: ${t.slice(0, 120)}`);
    }
    const payload = (await resp.json().catch(() => {
      throw new Error("Overpass ส่งข้อมูลกลับมาไม่ใช่ JSON");
    })) as T;
    overpassJsonCache.set(query, { storedAt: Date.now(), payload });
    if (overpassJsonCache.size > OVERPASS_JSON_CACHE_MAX) {
      const oldest = overpassJsonCache.keys().next().value;
      if (oldest) overpassJsonCache.delete(oldest);
    }
    return payload;
  })();

  overpassJsonInflight.set(query, promise);
  try {
    return cloneJson<T>(await promise);
  } finally {
    overpassJsonInflight.delete(query);
  }
}

export type Bbox = [south: number, west: number, north: number, east: number];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build an Overpass QL query for the given presets + free-text.
 * bbox = [south, west, north, east]
 */
export function buildOverpassQuery(
  presetKeys: string[],
  freeText: string | null,
  bbox: Bbox,
): string {
  const [s, w, n, e] = bbox;
  const bboxStr = `${s},${w},${n},${e}`;
  const parts: string[] = [];

  for (const key of presetKeys) {
    const preset = PRESET_BY_KEY[key];
    if (!preset) continue;
    for (const filter of preset.tags) {
      const tagStr = filter.map(([k, v]) => `["${k}"="${v}"]`).join("");
      parts.push(`  node${tagStr}(${bboxStr});`);
      parts.push(`  way${tagStr}(${bboxStr});`);
    }
  }

  const ft = freeText?.trim();
  if (ft) {
    const rx = escapeRegex(ft);
    parts.push(`  node["name"~"${rx}",i](${bboxStr});`);
    parts.push(`  way["name"~"${rx}",i](${bboxStr});`);
  }

  if (parts.length === 0) return "";
  return `[out:json][timeout:40];\n(\n${parts.join("\n")}\n);\nout center tags;`;
}

export type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type OverpassResponse = {
  elements: OverpassElement[];
  remark?: string;
};

export function haversineMeters(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const la1 = toRad(aLat);
  const la2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Classify an OSM element into one of our preset keys (best-effort).
 * Falls back to "other" when no preset matches.
 */
export function classifyPreset(tags: Record<string, string> | undefined): string {
  if (!tags) return "other";
  // Non-OSM providers (Google Places fallback) tag the preset explicitly.
  const explicit = tags["poi:preset"];
  if (explicit && PRESET_BY_KEY[explicit]) return explicit;
  for (const preset of POI_PRESETS) {
    for (const filter of preset.tags) {
      if (filter.every(([k, v]) => tags[k] === v)) return preset.key;
    }
  }
  return "other";
}
