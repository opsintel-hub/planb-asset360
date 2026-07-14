// Tunable weights for billboard analytics (Traffic score, Demographics %,
// Peak hours, Impressions). Stored in `app_settings.analytics_weights` and
// merged with defaults at runtime. Bucket matcher functions stay in code —
// only weights/labels are user-editable.

export type DemographicKey = "office" | "student" | "shopper" | "resident" | "tourist";
export type RoadClass = "motorway" | "trunk" | "primary" | "secondary" | "tertiary" | "residential" | "service" | "other";

export const BUCKET_KEYS = [
  "office",
  "mall",
  "shop",
  "school",
  "transit",
  "food",
  "hotel",
  "residential",
  "hospital",
  "car",
  "tourist",
] as const;
export type BucketKey = (typeof BUCKET_KEYS)[number];

export const BUCKET_LABELS: Record<BucketKey, string> = {
  office: "อาคารสำนักงาน",
  mall: "ห้าง / ค้าปลีกใหญ่",
  shop: "ร้านค้า",
  school: "โรงเรียน / มหาวิทยาลัย",
  transit: "ขนส่งสาธารณะ",
  food: "ร้านอาหาร / คาเฟ่",
  hotel: "โรงแรม / ที่พัก",
  residential: "ที่อยู่อาศัย",
  hospital: "โรงพยาบาล",
  car: "โชว์รูมรถ / ปั๊มน้ำมัน",
  tourist: "สถานที่ท่องเที่ยว",
};

export const DEMOGRAPHIC_LABELS: Record<DemographicKey, string> = {
  office: "พนักงานออฟฟิศ",
  student: "นักเรียน / นักศึกษา",
  shopper: "นักช้อป",
  resident: "ผู้อยู่อาศัย",
  tourist: "นักท่องเที่ยว",
};

export const ROAD_LABELS: Record<RoadClass, string> = {
  motorway: "มอเตอร์เวย์",
  trunk: "ถนนสายหลัก (Trunk)",
  primary: "Primary",
  secondary: "Secondary",
  tertiary: "Tertiary",
  residential: "ถนนในหมู่บ้าน",
  service: "ทางบริการ",
  other: "อื่น ๆ",
};

export type AnalyticsWeights = {
  /** Demographic score contribution per bucket, per demographic key. */
  demographics: Record<BucketKey, Partial<Record<DemographicKey, number>>>;
  /** Road-class contribution to Traffic score (multiplied by min(count,3)). */
  road: Record<RoadClass, number>;
  /** Impressions/day = trafficScore × min .. max */
  impressions: { min: number; max: number };
  /** Peak-hour ranges per dominant demographic (2 strings each). */
  peaks: Record<DemographicKey, [string, string]>;
};

export const DEFAULT_ANALYTICS_WEIGHTS: AnalyticsWeights = {
  demographics: {
    office: { office: 5 },
    mall: { shopper: 5, tourist: 1 },
    shop: { shopper: 2, resident: 1 },
    school: { student: 5 },
    transit: { office: 2, student: 2, shopper: 1 },
    food: { office: 1, shopper: 2, resident: 1 },
    hotel: { tourist: 5 },
    residential: { resident: 5 },
    hospital: { resident: 1, office: 1 },
    car: { shopper: 1, resident: 1 },
    tourist: { tourist: 4 },
  },
  road: {
    motorway: 40,
    trunk: 35,
    primary: 28,
    secondary: 20,
    tertiary: 14,
    residential: 6,
    service: 2,
    other: 4,
  },
  impressions: { min: 200, max: 600 },
  peaks: {
    office: ["07:30–09:30", "17:00–19:00"],
    student: ["07:00–08:30", "15:30–17:00"],
    shopper: ["11:00–14:00", "17:00–21:00"],
    resident: ["07:00–09:00", "18:00–21:00"],
    tourist: ["10:00–12:00", "14:00–18:00"],
  },
};

/** Merge user overrides on top of defaults, filling in any missing keys. */
export function mergeAnalyticsWeights(
  raw: unknown,
): AnalyticsWeights {
  const d = DEFAULT_ANALYTICS_WEIGHTS;
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<AnalyticsWeights>;
  const demographics = { ...d.demographics };
  if (r.demographics && typeof r.demographics === "object") {
    for (const k of BUCKET_KEYS) {
      const src = (r.demographics as Record<string, Partial<Record<DemographicKey, number>>>)[k];
      if (src && typeof src === "object") {
        demographics[k] = { ...d.demographics[k], ...src };
      }
    }
  }
  const road = { ...d.road };
  if (r.road && typeof r.road === "object") {
    for (const k of Object.keys(d.road) as RoadClass[]) {
      const v = (r.road as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isFinite(v)) road[k] = v;
    }
  }
  const impressions = { ...d.impressions };
  if (r.impressions && typeof r.impressions === "object") {
    const min = Number((r.impressions as { min?: number }).min);
    const max = Number((r.impressions as { max?: number }).max);
    if (Number.isFinite(min) && min >= 0) impressions.min = min;
    if (Number.isFinite(max) && max >= 0) impressions.max = max;
  }
  const peaks = { ...d.peaks };
  if (r.peaks && typeof r.peaks === "object") {
    for (const k of Object.keys(d.peaks) as DemographicKey[]) {
      const arr = (r.peaks as Record<string, unknown>)[k];
      if (Array.isArray(arr) && arr.length === 2 && arr.every((x) => typeof x === "string")) {
        peaks[k] = [arr[0] as string, arr[1] as string];
      }
    }
  }
  return { demographics, road, impressions, peaks };
}
