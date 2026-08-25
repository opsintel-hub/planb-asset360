// Google Places fallback provider for POI search.
// Used when public Overpass (OpenStreetMap) mirrors are unavailable so that the
// POI feature keeps working. Queries Places "searchNearby" on de-duplicated
// circles around the assets we already selected, which maps naturally onto the
// "POIs within R metres of an asset" question.

import type { OverpassElement, OverpassResponse } from "./overpass";

const GATEWAY = "https://connector-gateway.lovable.dev/google_maps/places/v1/places:searchNearby";

// preset key -> Google Places (New) included types
const PRESET_GOOGLE_TYPES: Record<string, string[]> = {
  mall: ["shopping_mall", "department_store"],
  car_dealer: ["car_dealer"],
  subway: ["subway_station", "train_station", "light_rail_station"],
  bus_stop: ["bus_stop", "bus_station"],
  school: ["school", "primary_school", "secondary_school"],
  university: ["university"],
  hospital: ["hospital"],
  fuel: ["gas_station"],
  hotel: ["hotel"],
  cafe: ["cafe", "coffee_shop"],
  restaurant: ["restaurant"],
  bank: ["bank"],
  market: ["market", "supermarket"],
  park: ["park"],
  convenience: ["convenience_store"],
};

// Reverse map: Google type -> preset key (first match wins)
const GOOGLE_TYPE_TO_PRESET = new Map<string, string>();
for (const [preset, types] of Object.entries(PRESET_GOOGLE_TYPES)) {
  for (const t of types) if (!GOOGLE_TYPE_TO_PRESET.has(t)) GOOGLE_TYPE_TO_PRESET.set(t, preset);
}

const MAX_CIRCLES = 40;
const CONCURRENCY = 4;

type Pt = { lat: number; lng: number };

/** De-duplicate asset points onto a grid roughly the size of the search radius. */
function pickCircles(points: Pt[], radiusM: number): Pt[] {
  const cell = Math.max(radiusM, 250) * 1.5;
  const latStep = cell / 111000;
  const seen = new Map<string, Pt>();
  for (const p of points) {
    const lngStep = cell / ((111000 * Math.cos((p.lat * Math.PI) / 180)) || 1);
    const key = `${Math.round(p.lat / latStep)}:${Math.round(p.lng / lngStep)}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  return Array.from(seen.values()).slice(0, MAX_CIRCLES);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

type PlacesPlace = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  primaryType?: string;
};

export function isPlacesFallbackAvailable(): boolean {
  return !!process.env['LOVABLE_API_KEY'] && !!process.env['GOOGLE_MAPS_API_KEY'];
}

/**
 * Fetch POIs with Google Places and return them in the Overpass response shape
 * so downstream matching code stays unchanged.
 */
export async function fetchPoisFromPlaces(args: {
  presetKeys: string[];
  radiusM: number;
  assetPoints: Pt[];
}): Promise<{ raw: OverpassResponse; warnings: string[]; circles: number }> {
  const apiKey = process.env['LOVABLE_API_KEY'];
  const connKey = process.env['GOOGLE_MAPS_API_KEY'];
  if (!apiKey || !connKey) throw new Error("ยังไม่ได้เชื่อม Google Maps connector");

  const includedTypes = Array.from(
    new Set(args.presetKeys.flatMap((k) => PRESET_GOOGLE_TYPES[k] ?? [])),
  );
  if (includedTypes.length === 0) {
    throw new Error("ประเภทสถานที่ที่เลือกยังไม่รองรับโหมดสำรอง (Google Places)");
  }

  const circles = pickCircles(args.assetPoints, args.radiusM);
  if (circles.length === 0) throw new Error("ไม่มีจุดป้ายสำหรับค้นหา");

  const warnings: string[] = [];
  const searchRadius = Math.min(50000, Math.max(args.radiusM * 1.6, 400));

  const results = await mapWithConcurrency(circles, CONCURRENCY, async (c) => {
    try {
      const resp = await fetch(GATEWAY, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "X-Connection-Api-Key": connKey,
          "Content-Type": "application/json",
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.location,places.types,places.primaryType",
        },
        body: JSON.stringify({
          includedTypes,
          maxResultCount: 20,
          languageCode: "th",
          regionCode: "TH",
          locationRestriction: {
            circle: { center: { latitude: c.lat, longitude: c.lng }, radius: searchRadius },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status} ${body.slice(0, 120)}`);
      }
      const payload = (await resp.json()) as { places?: PlacesPlace[] };
      return payload.places ?? [];
    } catch (e) {
      warnings.push((e as Error).message);
      return [] as PlacesPlace[];
    }
  });

  const seen = new Set<string>();
  const elements: OverpassElement[] = [];
  for (const places of results) {
    for (const p of places) {
      const lat = p.location?.latitude;
      const lng = p.location?.longitude;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      const id = p.id ?? `${lat},${lng}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const types = [p.primaryType, ...(p.types ?? [])].filter((t): t is string => !!t);
      const preset = types.map((t) => GOOGLE_TYPE_TO_PRESET.get(t)).find((x) => !!x);
      elements.push({
        type: "node",
        id: Math.abs(hashString(id)),
        lat,
        lon: lng,
        tags: {
          name: p.displayName?.text ?? "(ไม่มีชื่อ)",
          "poi:source": "google_places",
          ...(preset ? { "poi:preset": preset } : {}),
        },
      });
    }
  }

  if (elements.length === 0 && warnings.length > 0) {
    throw new Error(`Google Places สำรองล้มเหลว: ${warnings[0]}`);
  }

  return {
    raw: { elements },
    warnings: [
      `ใช้ข้อมูลสำรองจาก Google Places (OSM ไม่พร้อมใช้งาน) — ค้นรอบจุดป้าย ${circles.length} จุด`,
      ...(warnings.length > 0 ? [`มีบางจุดค้นไม่สำเร็จ (${warnings.length})`] : []),
    ],
    circles: circles.length,
  };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}
