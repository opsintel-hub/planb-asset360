// Offline Thai region / province resolver — pure math, no API, no credits.
// Province is inferred from the asset's lat/lng by nearest province centroid,
// which is accurate enough for planning-level filtering.

export type RegionKey =
  | "north"
  | "upper-northeast"
  | "lower-northeast"
  | "central"
  | "east"
  | "west"
  | "south";

export const REGION_LABELS: Record<RegionKey, string> = {
  north: "ภาคเหนือ",
  "upper-northeast": "อีสานบน",
  "lower-northeast": "อีสานล่าง",
  central: "ภาคกลาง",
  east: "ภาคตะวันออก",
  west: "ภาคตะวันตก",
  south: "ภาคใต้",
};

export const REGION_ORDER: RegionKey[] = [
  "north",
  "upper-northeast",
  "lower-northeast",
  "central",
  "east",
  "west",
  "south",
];

type Prov = { name: string; lat: number; lng: number; region: RegionKey };

export const PROVINCES: Prov[] = [
  // ---- ภาคเหนือ ----
  { name: "เชียงใหม่", lat: 18.788, lng: 98.985, region: "north" },
  { name: "เชียงราย", lat: 19.909, lng: 99.827, region: "north" },
  { name: "ลำพูน", lat: 18.574, lng: 99.008, region: "north" },
  { name: "ลำปาง", lat: 18.288, lng: 99.491, region: "north" },
  { name: "แม่ฮ่องสอน", lat: 19.301, lng: 97.968, region: "north" },
  { name: "น่าน", lat: 18.783, lng: 100.778, region: "north" },
  { name: "พะเยา", lat: 19.166, lng: 99.902, region: "north" },
  { name: "แพร่", lat: 18.145, lng: 100.141, region: "north" },
  { name: "อุตรดิตถ์", lat: 17.62, lng: 100.099, region: "north" },
  { name: "ตาก", lat: 16.884, lng: 99.126, region: "north" },
  { name: "สุโขทัย", lat: 17.007, lng: 99.823, region: "north" },
  { name: "พิษณุโลก", lat: 16.822, lng: 100.266, region: "north" },
  { name: "พิจิตร", lat: 16.439, lng: 100.349, region: "north" },
  { name: "กำแพงเพชร", lat: 16.483, lng: 99.522, region: "north" },
  { name: "เพชรบูรณ์", lat: 16.419, lng: 101.161, region: "north" },
  { name: "นครสวรรค์", lat: 15.704, lng: 100.137, region: "north" },
  { name: "อุทัยธานี", lat: 15.379, lng: 100.025, region: "north" },

  // ---- อีสานบน ----
  { name: "อุดรธานี", lat: 17.413, lng: 102.788, region: "upper-northeast" },
  { name: "หนองคาย", lat: 17.878, lng: 102.742, region: "upper-northeast" },
  { name: "บึงกาฬ", lat: 18.361, lng: 103.646, region: "upper-northeast" },
  { name: "เลย", lat: 17.486, lng: 101.727, region: "upper-northeast" },
  { name: "หนองบัวลำภู", lat: 17.204, lng: 102.44, region: "upper-northeast" },
  { name: "สกลนคร", lat: 17.161, lng: 104.147, region: "upper-northeast" },
  { name: "นครพนม", lat: 17.41, lng: 104.779, region: "upper-northeast" },
  { name: "มุกดาหาร", lat: 16.542, lng: 104.723, region: "upper-northeast" },
  { name: "ขอนแก่น", lat: 16.441, lng: 102.836, region: "upper-northeast" },
  { name: "กาฬสินธุ์", lat: 16.433, lng: 103.507, region: "upper-northeast" },
  { name: "มหาสารคาม", lat: 16.185, lng: 103.302, region: "upper-northeast" },
  { name: "ชัยภูมิ", lat: 15.806, lng: 102.032, region: "upper-northeast" },

  // ---- อีสานล่าง ----
  { name: "นครราชสีมา", lat: 14.973, lng: 102.098, region: "lower-northeast" },
  { name: "บุรีรัมย์", lat: 14.994, lng: 103.104, region: "lower-northeast" },
  { name: "สุรินทร์", lat: 14.883, lng: 103.494, region: "lower-northeast" },
  { name: "ศรีสะเกษ", lat: 15.118, lng: 104.323, region: "lower-northeast" },
  { name: "อุบลราชธานี", lat: 15.244, lng: 104.848, region: "lower-northeast" },
  { name: "ยโสธร", lat: 15.794, lng: 104.145, region: "lower-northeast" },
  { name: "อำนาจเจริญ", lat: 15.866, lng: 104.626, region: "lower-northeast" },
  { name: "ร้อยเอ็ด", lat: 16.055, lng: 103.653, region: "lower-northeast" },

  // ---- ภาคกลาง ----
  { name: "กรุงเทพมหานคร", lat: 13.746, lng: 100.535, region: "central" },
  { name: "นนทบุรี", lat: 13.86, lng: 100.514, region: "central" },
  { name: "ปทุมธานี", lat: 14.02, lng: 100.525, region: "central" },
  { name: "สมุทรปราการ", lat: 13.599, lng: 100.597, region: "central" },
  { name: "สมุทรสาคร", lat: 13.547, lng: 100.274, region: "central" },
  { name: "นครปฐม", lat: 13.82, lng: 100.062, region: "central" },
  { name: "พระนครศรีอยุธยา", lat: 14.353, lng: 100.578, region: "central" },
  { name: "อ่างทอง", lat: 14.589, lng: 100.455, region: "central" },
  { name: "สิงห์บุรี", lat: 14.888, lng: 100.397, region: "central" },
  { name: "ชัยนาท", lat: 15.186, lng: 100.125, region: "central" },
  { name: "ลพบุรี", lat: 14.799, lng: 100.653, region: "central" },
  { name: "สระบุรี", lat: 14.529, lng: 100.911, region: "central" },
  { name: "นครนายก", lat: 14.204, lng: 101.213, region: "central" },
  { name: "สุพรรณบุรี", lat: 14.474, lng: 100.117, region: "central" },
  { name: "สมุทรสงคราม", lat: 13.409, lng: 100.0, region: "central" },

  // ---- ภาคตะวันออก ----
  { name: "ชลบุรี", lat: 13.361, lng: 100.985, region: "east" },
  { name: "ระยอง", lat: 12.681, lng: 101.257, region: "east" },
  { name: "จันทบุรี", lat: 12.61, lng: 102.104, region: "east" },
  { name: "ตราด", lat: 12.243, lng: 102.516, region: "east" },
  { name: "ฉะเชิงเทรา", lat: 13.69, lng: 101.078, region: "east" },
  { name: "ปราจีนบุรี", lat: 14.047, lng: 101.373, region: "east" },
  { name: "สระแก้ว", lat: 13.824, lng: 102.064, region: "east" },

  // ---- ภาคตะวันตก ----
  { name: "กาญจนบุรี", lat: 14.022, lng: 99.532, region: "west" },
  { name: "ราชบุรี", lat: 13.528, lng: 99.814, region: "west" },
  { name: "เพชรบุรี", lat: 13.111, lng: 99.94, region: "west" },
  { name: "ประจวบคีรีขันธ์", lat: 11.812, lng: 99.797, region: "west" },

  // ---- ภาคใต้ ----
  { name: "ชุมพร", lat: 10.494, lng: 99.18, region: "south" },
  { name: "ระนอง", lat: 9.963, lng: 98.638, region: "south" },
  { name: "สุราษฎร์ธานี", lat: 9.14, lng: 99.333, region: "south" },
  { name: "พังงา", lat: 8.451, lng: 98.525, region: "south" },
  { name: "ภูเก็ต", lat: 7.88, lng: 98.392, region: "south" },
  { name: "กระบี่", lat: 8.086, lng: 98.906, region: "south" },
  { name: "นครศรีธรรมราช", lat: 8.432, lng: 99.963, region: "south" },
  { name: "ตรัง", lat: 7.559, lng: 99.611, region: "south" },
  { name: "พัทลุง", lat: 7.617, lng: 100.077, region: "south" },
  { name: "สตูล", lat: 6.624, lng: 100.067, region: "south" },
  { name: "สงขลา", lat: 7.199, lng: 100.595, region: "south" },
  { name: "ปัตตานี", lat: 6.869, lng: 101.25, region: "south" },
  { name: "ยะลา", lat: 6.541, lng: 101.28, region: "south" },
  { name: "นราธิวาส", lat: 6.426, lng: 101.823, region: "south" },
];

// Bangkok khet names — overrides the centroid guess for the dense metro core.
const BKK_DISTRICTS = new Set([
  "พระนคร","ดุสิต","หนองจอก","บางรัก","บางรัก","บางรัก","บางเขน","บางกะปิ","ปทุมวัน","ป้อมปราบศัตรูพ่าย",
  "พระโขนง","มีนบุรี","ลาดกระบัง","ยานนาวา","สัมพันธวงศ์","พญาไท","ธนบุรี","บางกอกใหญ่","ห้วยขวาง",
  "คลองสาน","ตลิ่งชัน","บางกอกน้อย","บางขุนเทียน","ภาษีเจริญ","หนองแขม","ราษฎร์บูรณะ","บางพลัด",
  "ดินแดง","บึงกุ่ม","สาทร","บางซื่อ","จตุจักร","บางคอแหลม","ประเวศ","คลองเตย","สวนหลวง","จอมทอง",
  "ดอนเมือง","ราชเทวี","ลาดพร้าว","วัฒนา","บางแค","หลักสี่","สายไหม","คันนายาว","สะพานสูง","วังทองหลาง",
  "คลองสามวา","บางนา","ทวีวัฒนา","ทุ่งครุ","บางบอน","บางบ่อ",
]);

function norm(s: string | null | undefined) {
  return (s ?? "").replace(/^(เขต|อำเภอ|อ\.)\s*/, "").trim();
}

/** Nearest-province lookup from coordinates (equirectangular squared distance). */
export function provinceForPoint(
  lat: number,
  lng: number,
  district?: string | null,
): string {
  const d = norm(district);
  if (d && BKK_DISTRICTS.has(d) && lat > 13.4 && lat < 14.05 && lng > 100.2 && lng < 100.95) {
    return "กรุงเทพมหานคร";
  }
  let best = PROVINCES[0];
  let bestD = Infinity;
  for (const p of PROVINCES) {
    const dy = p.lat - lat;
    const dx = (p.lng - lng) * Math.cos((lat * Math.PI) / 180);
    const dd = dy * dy + dx * dx;
    if (dd < bestD) {
      bestD = dd;
      best = p;
    }
  }
  return best.name;
}

const PROVINCE_REGION = new Map(PROVINCES.map((p) => [p.name, p.region] as const));

export function regionForProvince(province: string | null | undefined): RegionKey | null {
  if (!province) return null;
  return PROVINCE_REGION.get(province) ?? null;
}

export function provincesInRegions(regions: RegionKey[]): string[] {
  if (regions.length === 0) return PROVINCES.map((p) => p.name);
  const set = new Set(regions);
  return PROVINCES.filter((p) => set.has(p.region)).map((p) => p.name);
}
