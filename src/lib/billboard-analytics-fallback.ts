import { haversineMeters } from "./overpass";
import type { BillboardAnalytics, DemographicsMix, POIBucket, RoadInfo } from "./billboard-analytics.functions";

type BucketDefinition = {
  key: string;
  label: string;
  icon: string;
  color: string;
  demographicsWeight: Partial<DemographicsMix>;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  primaryType?: string;
  types?: string[];
  location?: { latitude?: number; longitude?: number };
};

export async function analyzeWithGooglePlacesFallback(args: {
  lat: number;
  lng: number;
  radiusM: number;
  overpassError: string;
  buckets: BucketDefinition[];
  peaksFor: (dom: keyof DemographicsMix) => string[];
}): Promise<BillboardAnalytics | null> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) return null;

  const { lat, lng, radiusM, buckets, peaksFor, overpassError } = args;
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
    const bucketCounts = new Map<string, number>();
    const demographics: DemographicsMix = { office: 0, student: 0, shopper: 0, resident: 0, tourist: 0 };
    const nearbyPOIs: BillboardAnalytics["topPOIs"] = [];

    for (const p of payload.places ?? []) {
      const pLat = p.location?.latitude;
      const pLng = p.location?.longitude;
      if (typeof pLat !== "number" || typeof pLng !== "number") continue;
      const type = p.primaryType ?? p.types?.[0] ?? "store";
      const bucket = bucketForGoogleType(type);
      const def = buckets.find((b) => b.key === bucket) ?? buckets.find((b) => b.key === "shop") ?? buckets[0];
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
    const outBuckets: POIBucket[] = buckets
      .map(({ key, label, icon, color }) => ({ key, label, icon, color, count: bucketCounts.get(key) ?? 0 }))
      .filter((b) => b.count > 0)
      .sort((a, b) => b.count - a.count);
    const trafficScore = Math.min(100, Math.max(10, Math.round(nearbyPOIs.length * 4)));
    const dominant = (Object.entries(demoPct) as Array<[keyof DemographicsMix, number]>).sort((a, b) => b[1] - a[1])[0][0];
    const nearestRoad: RoadInfo | null = null;

    return {
      ok: true,
      center: { lat, lng },
      radiusM,
      totalPOIs: nearbyPOIs.length,
      buckets: outBuckets,
      topPOIs: nearbyPOIs.sort((a, b) => a.distanceM - b.distanceM).slice(0, 12),
      nearestRoad,
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