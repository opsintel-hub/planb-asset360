// Phase 3 — Billboard Analytics
// Given a billboard location (lat/lng), query Overpass for surrounding POIs +
// nearby highways and produce a heuristic profile:
//   - demographics mix (office / student / shopper / resident / tourist)
//   - traffic score (Low / Med / High) from road class + POI density
//   - suggested peak hours
// All computation uses FREE OpenStreetMap data — no paid API required.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  fetchOverpass,
  haversineMeters,
  type OverpassResponse,
} from "./overpass";

export type AnalyticsInput = {
  lat: number;
  lng: number;
  radiusM?: number; // default 500
};

export type POIBucket = {
  key: string;
  label: string;
  icon: string;
  color: string;
  count: number;
};

export type NearbyPOI = {
  id: string;
  name: string;
  category: string;
  distanceM: number;
};

export type RoadInfo = {
  class: "motorway" | "trunk" | "primary" | "secondary" | "tertiary" | "residential" | "service" | "other";
  name: string | null;
  distanceM: number;
};

export type DemographicsMix = {
  office: number;
  student: number;
  shopper: number;
  resident: number;
  tourist: number;
};

export type BillboardAnalytics = {
  ok: boolean;
  error?: string;
  center: { lat: number; lng: number };
  radiusM: number;
  totalPOIs: number;
  buckets: POIBucket[];
  topPOIs: NearbyPOI[];
  nearestRoad: RoadInfo | null;
  roadClasses: Record<string, number>;
  demographics: DemographicsMix;
  trafficScore: number; // 0-100
  trafficLabel: "ต่ำ" | "ปานกลาง" | "สูง" | "สูงมาก";
  peakHours: string[]; // e.g. ["07:00–09:00", "17:00–19:00"]
  estimatedDailyImpressions: { min: number; max: number };
  notes: string[];
};

// Bucket definitions — group POIs into "audience-generating" categories.
const BUCKETS: Array<{
  key: string;
  label: string;
  icon: string;
  color: string;
  match: (tags: Record<string, string>) => boolean;
  demographicsWeight: Partial<DemographicsMix>;
}> = [
  {
    key: "office",
    label: "อาคารสำนักงาน",
    icon: "🏢",
    color: "#3b82f6",
    match: (t) => t.office != null || t.building === "office" || t.building === "commercial",
    demographicsWeight: { office: 5 },
  },
  {
    key: "mall",
    label: "ห้าง / ค้าปลีกใหญ่",
    icon: "🏬",
    color: "#a855f7",
    match: (t) => t.shop === "mall" || t.shop === "department_store",
    demographicsWeight: { shopper: 5, tourist: 1 },
  },
  {
    key: "shop",
    label: "ร้านค้า",
    icon: "🛍️",
    color: "#ec4899",
    match: (t) => t.shop != null && t.shop !== "mall" && t.shop !== "department_store" && t.shop !== "car",
    demographicsWeight: { shopper: 2, resident: 1 },
  },
  {
    key: "school",
    label: "โรงเรียน / มหาวิทยาลัย",
    icon: "🎓",
    color: "#6366f1",
    match: (t) => t.amenity === "school" || t.amenity === "university" || t.amenity === "college",
    demographicsWeight: { student: 5 },
  },
  {
    key: "transit",
    label: "ขนส่งสาธารณะ",
    icon: "🚇",
    color: "#0ea5e9",
    match: (t) => t.railway === "station" || t.station === "subway" || t.highway === "bus_stop" || t.public_transport != null,
    demographicsWeight: { office: 2, student: 2, shopper: 1 },
  },
  {
    key: "food",
    label: "ร้านอาหาร / คาเฟ่",
    icon: "🍽️",
    color: "#e11d48",
    match: (t) => t.amenity === "restaurant" || t.amenity === "cafe" || t.amenity === "fast_food",
    demographicsWeight: { office: 1, shopper: 2, resident: 1 },
  },
  {
    key: "hotel",
    label: "โรงแรม / ที่พัก",
    icon: "🏨",
    color: "#0891b2",
    match: (t) => t.tourism === "hotel" || t.tourism === "hostel" || t.tourism === "guest_house",
    demographicsWeight: { tourist: 5 },
  },
  {
    key: "residential",
    label: "ที่อยู่อาศัย",
    icon: "🏘️",
    color: "#059669",
    match: (t) => t.building === "residential" || t.building === "apartments" || t.landuse === "residential",
    demographicsWeight: { resident: 5 },
  },
  {
    key: "hospital",
    label: "โรงพยาบาล",
    icon: "🏥",
    color: "#dc2626",
    match: (t) => t.amenity === "hospital" || t.amenity === "clinic",
    demographicsWeight: { resident: 1, office: 1 },
  },
  {
    key: "car",
    label: "โชว์รูมรถ / ปั๊มน้ำมัน",
    icon: "🚗",
    color: "#ef4444",
    match: (t) => t.shop === "car" || t.amenity === "fuel",
    demographicsWeight: { shopper: 1, resident: 1 },
  },
  {
    key: "tourist",
    label: "สถานที่ท่องเที่ยว",
    icon: "🗺️",
    color: "#f59e0b",
    match: (t) => t.tourism === "attraction" || t.tourism === "museum" || t.historic != null,
    demographicsWeight: { tourist: 4 },
  },
];

const ROAD_WEIGHT: Record<string, number> = {
  motorway: 40,
  trunk: 35,
  primary: 28,
  secondary: 20,
  tertiary: 14,
  residential: 6,
  service: 2,
  other: 4,
};

function classifyRoad(hw: string | undefined): RoadInfo["class"] {
  if (!hw) return "other";
  if (hw.startsWith("motorway")) return "motorway";
  if (hw.startsWith("trunk")) return "trunk";
  if (hw.startsWith("primary")) return "primary";
  if (hw.startsWith("secondary")) return "secondary";
  if (hw.startsWith("tertiary")) return "tertiary";
  if (hw === "residential" || hw === "living_street") return "residential";
  if (hw === "service") return "service";
  return "other";
}

function bboxAround(lat: number, lng: number, radiusM: number): [number, number, number, number] {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
}

export const analyzeBillboardArea = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AnalyticsInput) => {
    if (!input || typeof input !== "object") throw new Error("invalid input");
    const lat = Number(input.lat);
    const lng = Number(input.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("invalid coordinates");
    const r = Number(input.radiusM ?? 500);
    if (!Number.isFinite(r) || r < 100 || r > 2000) throw new Error("invalid radiusM");
    return { lat, lng, radiusM: r };
  })
  .handler(async ({ data }): Promise<BillboardAnalytics> => {
    const { lat, lng, radiusM } = data;
    const [s, w, n, e] = bboxAround(lat, lng, radiusM);
    const bboxStr = `${s},${w},${n},${e}`;

    // Query POIs + roads in one Overpass call
    const query = `[out:json][timeout:25];
(
  node["shop"](${bboxStr});
  way["shop"](${bboxStr});
  node["amenity"](${bboxStr});
  way["amenity"](${bboxStr});
  node["tourism"](${bboxStr});
  way["tourism"](${bboxStr});
  node["office"](${bboxStr});
  way["office"](${bboxStr});
  way["building"~"office|commercial|residential|apartments"](${bboxStr});
  way["landuse"="residential"](${bboxStr});
  node["railway"="station"](${bboxStr});
  node["highway"="bus_stop"](${bboxStr});
  way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|service"](${bboxStr});
);
out center tags;`;

    let raw: OverpassResponse;
    try {
      const resp = await fetchOverpass(query);
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        return emptyResult(lat, lng, radiusM, `Overpass ${resp.status}: ${t.slice(0, 120)}`);
      }
      raw = (await resp.json()) as OverpassResponse;
    } catch (err) {
      const fallback = await analyzeWithGooglePlaces(lat, lng, radiusM, (err as Error).message);
      if (fallback) return fallback;
      return emptyResult(lat, lng, radiusM, `Overpass ล้มเหลว: ${(err as Error).message}`);
    }

    // Classify each element
    const bucketCounts = new Map<string, number>();
    const demographics: DemographicsMix = { office: 0, student: 0, shopper: 0, resident: 0, tourist: 0 };
    const nearbyPOIs: NearbyPOI[] = [];
    const roadClasses: Record<string, number> = {};
    let nearestRoad: RoadInfo | null = null;

    for (const el of raw.elements ?? []) {
      const eLat = el.lat ?? el.center?.lat;
      const eLng = el.lon ?? el.center?.lon;
      const tags = el.tags ?? {};
      if (typeof eLat !== "number" || typeof eLng !== "number") continue;
      const dist = haversineMeters(lat, lng, eLat, eLng);
      if (dist > radiusM) continue;

      // Road?
      if (tags.highway) {
        const cls = classifyRoad(tags.highway);
        roadClasses[cls] = (roadClasses[cls] ?? 0) + 1;
        if (!nearestRoad || dist < nearestRoad.distanceM) {
          nearestRoad = { class: cls, name: tags.name ?? tags.ref ?? null, distanceM: Math.round(dist) };
        }
        continue;
      }

      // POI bucket
      for (const b of BUCKETS) {
        if (b.match(tags)) {
          bucketCounts.set(b.key, (bucketCounts.get(b.key) ?? 0) + 1);
          for (const [k, v] of Object.entries(b.demographicsWeight)) {
            demographics[k as keyof DemographicsMix] += v as number;
          }
          const name = tags.name || tags["name:th"] || tags["name:en"] || tags.brand || "(ไม่มีชื่อ)";
          nearbyPOIs.push({
            id: `${el.type[0]}${el.id}`,
            name,
            category: b.label,
            distanceM: Math.round(dist),
          });
          break;
        }
      }
    }

    // Normalize demographics to percentage
    const totalWeight = Object.values(demographics).reduce((a, b) => a + b, 0);
    const demoPct: DemographicsMix =
      totalWeight === 0
        ? { office: 20, student: 20, shopper: 20, resident: 20, tourist: 20 }
        : {
            office: Math.round((demographics.office / totalWeight) * 100),
            student: Math.round((demographics.student / totalWeight) * 100),
            shopper: Math.round((demographics.shopper / totalWeight) * 100),
            resident: Math.round((demographics.resident / totalWeight) * 100),
            tourist: Math.round((demographics.tourist / totalWeight) * 100),
          };

    // Buckets sorted
    const buckets: POIBucket[] = BUCKETS.map((b) => ({
      key: b.key,
      label: b.label,
      icon: b.icon,
      color: b.color,
      count: bucketCounts.get(b.key) ?? 0,
    }))
      .filter((b) => b.count > 0)
      .sort((a, b) => b.count - a.count);

    // Traffic score = road weight + POI density bonus
    let trafficScore = 0;
    for (const [cls, count] of Object.entries(roadClasses)) {
      trafficScore += (ROAD_WEIGHT[cls] ?? 4) * Math.min(count, 3);
    }
    trafficScore += Math.min(nearbyPOIs.length * 0.5, 30);
    trafficScore = Math.min(Math.round(trafficScore), 100);
    const trafficLabel: BillboardAnalytics["trafficLabel"] =
      trafficScore >= 75 ? "สูงมาก" : trafficScore >= 55 ? "สูง" : trafficScore >= 30 ? "ปานกลาง" : "ต่ำ";

    // Peak hours: derived from dominant demographic
    const dominant = (Object.entries(demoPct) as Array<[keyof DemographicsMix, number]>)
      .sort((a, b) => b[1] - a[1])[0][0];
    const peakHours = peaksFor(dominant);

    // Impressions estimate: rough — trafficScore * factor
    const dailyMin = trafficScore * 200;
    const dailyMax = trafficScore * 600;

    const notes: string[] = [];
    if (buckets.length === 0) notes.push("ไม่พบ POI ในรัศมี — พื้นที่อาจเป็นชานเมือง / ที่โล่ง");
    if (!nearestRoad) notes.push("ไม่พบข้อมูลถนนใน OSM รอบบริเวณนี้");
    if (nearestRoad && (nearestRoad.class === "motorway" || nearestRoad.class === "trunk"))
      notes.push("อยู่ติดถนนสายหลัก — เหมาะกับโฆษณาแบบ drive-by");
    if ((bucketCounts.get("mall") ?? 0) + (bucketCounts.get("shop") ?? 0) > 15)
      notes.push("ย่านค้าปลีกหนาแน่น — เหมาะกับสินค้าอุปโภคบริโภค");
    if ((bucketCounts.get("office") ?? 0) > 5) notes.push("ย่านออฟฟิศ — เหมาะกับ B2B / บริการทางการเงิน");

    return {
      ok: true,
      center: { lat, lng },
      radiusM,
      totalPOIs: nearbyPOIs.length,
      buckets,
      topPOIs: nearbyPOIs.sort((a, b) => a.distanceM - b.distanceM).slice(0, 12),
      nearestRoad,
      roadClasses,
      demographics: demoPct,
      trafficScore,
      trafficLabel,
      peakHours,
      estimatedDailyImpressions: { min: dailyMin, max: dailyMax },
      notes,
    };
  });

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  primaryType?: string;
  types?: string[];
  location?: { latitude?: number; longitude?: number };
};

async function analyzeWithGooglePlaces(
  lat: number,
  lng: number,
  radiusM: number,
  overpassError: string,
): Promise<BillboardAnalytics | null> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) return null;
  const includedTypes = [
    "shopping_mall",
    "department_store",
    "store",
    "convenience_store",
    "restaurant",
    "cafe",
    "school",
    "university",
    "hospital",
    "bus_station",
    "subway_station",
    "lodging",
    "tourist_attraction",
    "gas_station",
    "car_dealer",
  ];
  try {
    const resp = await fetch("https://connector-gateway.lovable.dev/google_maps/places/v1/places:searchNearby", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
        "Content-Type": "application/json",
        "X-Goog-FieldMask": "places.id,places.displayName,places.primaryType,places.types,places.location",
      },
      body: JSON.stringify({
        includedTypes,
        maxResultCount: 20,
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: radiusM },
        },
      }),
    });
    if (!resp.ok) return null;
    const payload = (await resp.json()) as { places?: GooglePlace[] };
    const places = payload.places ?? [];
    const bucketCounts = new Map<string, number>();
    const demographics: DemographicsMix = { office: 0, student: 0, shopper: 0, resident: 0, tourist: 0 };
    const nearbyPOIs: NearbyPOI[] = [];
    for (const p of places) {
      const pLat = p.location?.latitude;
      const pLng = p.location?.longitude;
      if (typeof pLat !== "number" || typeof pLng !== "number") continue;
      const type = p.primaryType ?? p.types?.[0] ?? "store";
      const bucket = bucketForGoogleType(type);
      const def = BUCKETS.find((b) => b.key === bucket) ?? BUCKETS[2];
      bucketCounts.set(def.key, (bucketCounts.get(def.key) ?? 0) + 1);
      for (const [k, v] of Object.entries(def.demographicsWeight)) {
        demographics[k as keyof DemographicsMix] += v as number;
      }
      nearbyPOIs.push({
        id: p.id ?? `${type}-${nearbyPOIs.length}`,
        name: p.displayName?.text ?? "(ไม่มีชื่อ)",
        category: def.label,
        distanceM: Math.round(haversineMeters(lat, lng, pLat, pLng)),
      });
    }
    const totalWeight = Object.values(demographics).reduce((a, b) => a + b, 0);
    const demoPct: DemographicsMix = totalWeight === 0
      ? { office: 20, student: 20, shopper: 20, resident: 20, tourist: 20 }
      : {
          office: Math.round((demographics.office / totalWeight) * 100),
          student: Math.round((demographics.student / totalWeight) * 100),
          shopper: Math.round((demographics.shopper / totalWeight) * 100),
          resident: Math.round((demographics.resident / totalWeight) * 100),
          tourist: Math.round((demographics.tourist / totalWeight) * 100),
        };
    const buckets: POIBucket[] = BUCKETS.map((b) => ({ ...b, count: bucketCounts.get(b.key) ?? 0 }))
      .filter((b) => b.count > 0)
      .map(({ key, label, icon, color, count }) => ({ key, label, icon, color, count }))
      .sort((a, b) => b.count - a.count);
    const trafficScore = Math.min(100, Math.max(10, Math.round(nearbyPOIs.length * 4)));
    const dominant = (Object.entries(demoPct) as Array<[keyof DemographicsMix, number]>).sort((a, b) => b[1] - a[1])[0][0];
    return {
      ok: true,
      center: { lat, lng },
      radiusM,
      totalPOIs: nearbyPOIs.length,
      buckets,
      topPOIs: nearbyPOIs.sort((a, b) => a.distanceM - b.distanceM).slice(0, 12),
      nearestRoad: null,
      roadClasses: {},
      demographics: demoPct,
      trafficScore,
      trafficLabel: trafficScore >= 75 ? "สูงมาก" : trafficScore >= 55 ? "สูง" : trafficScore >= 30 ? "ปานกลาง" : "ต่ำ",
      peakHours: peaksFor(dominant),
      estimatedDailyImpressions: { min: trafficScore * 180, max: trafficScore * 520 },
      notes: [`Overpass ไม่พร้อม จึงใช้ Google Places สำรอง`, overpassError.slice(0, 120)],
    };
  } catch {
    return null;
  }
}

function bucketForGoogleType(type: string): string {
  if (["shopping_mall", "department_store"].includes(type)) return "mall";
  if (["store", "convenience_store", "supermarket"].includes(type)) return "shop";
  if (["restaurant", "cafe", "fast_food"].includes(type)) return "food";
  if (["school", "university"].includes(type)) return "school";
  if (["bus_station", "subway_station", "train_station", "transit_station"].includes(type)) return "transit";
  if (["hospital", "doctor", "clinic"].includes(type)) return "hospital";
  if (["lodging", "hotel"].includes(type)) return "hotel";
  if (["tourist_attraction", "museum"].includes(type)) return "tourist";
  if (["gas_station", "car_dealer"].includes(type)) return "car";
  return "shop";
}

function peaksFor(dom: keyof DemographicsMix): string[] {
  switch (dom) {
    case "office": return ["07:30–09:30", "17:00–19:00"];
    case "student": return ["07:00–08:30", "15:30–17:00"];
    case "shopper": return ["11:00–14:00", "17:00–21:00"];
    case "resident": return ["07:00–09:00", "18:00–21:00"];
    case "tourist": return ["10:00–12:00", "14:00–18:00"];
  }
}

function emptyResult(lat: number, lng: number, radiusM: number, error: string): BillboardAnalytics {
  return {
    ok: false,
    error,
    center: { lat, lng },
    radiusM,
    totalPOIs: 0,
    buckets: [],
    topPOIs: [],
    nearestRoad: null,
    roadClasses: {},
    demographics: { office: 0, student: 0, shopper: 0, resident: 0, tourist: 0 },
    trafficScore: 0,
    trafficLabel: "ต่ำ",
    peakHours: [],
    estimatedDailyImpressions: { min: 0, max: 0 },
    notes: [],
  };
}
