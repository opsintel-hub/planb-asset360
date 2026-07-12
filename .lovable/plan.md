
# POI Proximity Search + API Settings UI

รับทราบ 2 จุดเพิ่ม:
1. **Multi-Select Dropdown** สำหรับเลือกประเภทสถานที่ (เลือกได้หลายอย่างพร้อมกัน) + **Free-text** ค้นหาชื่อได้
2. **หน้า UI ตั้งค่า API ภายนอก** แยกต่างหากในหน้า `/settings` เพื่อให้ตรวจสอบสถานะการเชื่อมต่อ APIs ได้

---

## Phase 1 — Settings: หน้า "API ภายนอก" (สร้างก่อน เพื่อให้ตรวจสอบได้)

### เพิ่มแท็บใหม่ในหน้า `/settings`
`src/routes/settings.tsx` เพิ่ม tab: **"API ภายนอก (External APIs)"** ข้าง Airtable

### Component ใหม่: `src/components/external-apis-section.tsx`
แสดงการ์ดต่อ 1 API:

```
┌─ Overpass API (OpenStreetMap) ─────────────┐
│ 🟢 พร้อมใช้งาน                              │
│                                             │
│ ใช้สำหรับ: ค้นหาสถานที่ (POI) เช่น ห้าง,    │
│           โชว์รูมรถ, BTS/MRT ฯลฯ            │
│ ค่าใช้จ่าย: ฟรี ไม่ต้องสมัคร key            │
│ Endpoint: overpass-api.de/api/interpreter   │
│ Rate limit: ~10,000 req/วัน                 │
│                                             │
│ [ทดสอบการเชื่อมต่อ]  ← กดแล้วยิงจริง        │
│ ผลล่าสุด: ✓ 245ms (14:23 น.)                │
└─────────────────────────────────────────────┘

┌─ OSRM Routing ─────────────────────────────┐
│ 🟢 พร้อมใช้งาน                              │
│ ใช้สำหรับ: คำนวณเส้นทางถนน (Route/Trip)     │
│ ค่าใช้จ่าย: ฟรี (public demo server)        │
│ [ทดสอบการเชื่อมต่อ]                         │
└─────────────────────────────────────────────┘

┌─ Google Maps / Street View (Optional) ────┐
│ 🟡 ยังไม่ได้ตั้งค่า                          │
│ ใช้สำหรับ: Street View + Mockup + PDF       │
│ ค่าใช้จ่าย: ฟรี $200/เดือน แล้วคิดเงิน       │
│ วิธีสมัคร: [คู่มือ 5 ขั้นตอน ▼]             │
│                                             │
│ API Key: [_____________________] [บันทึก]  │
│ (เก็บใน app_settings, admin เท่านั้น)       │
└─────────────────────────────────────────────┘

┌─ Nominatim (Geocoding) ────────────────────┐
│ 🟢 พร้อมใช้งาน (ฟรี — ใช้ค้นหาชื่อสถานที่)  │
│ [ทดสอบการเชื่อมต่อ]                         │
└─────────────────────────────────────────────┘
```

### Server functions ใหม่ (`src/lib/external-apis.functions.ts`)
- `pingOverpass()` → yigต่อ `[out:json];out;` เช็ค latency
- `pingOsrm()` → route สั้นๆ 2 จุดในกรุงเทพ
- `pingNominatim()` → ค้นหา "Bangkok"
- `pingGoogleMaps(key)` → ทดสอบ key ถ้ามี

---

## Phase 2 — POI Proximity Search

### 2.1 Helper: `src/lib/overpass.ts`
- ฟังก์ชัน `queryOverpass(bbox, filters[])` — สร้าง Overpass QL query จาก presets
- Preset catalog (`POI_PRESETS`):
  ```ts
  {
    mall: { label: "ห้างสรรพสินค้า", icon: "🏬", tags: [["shop","mall"],["shop","department_store"]] },
    car_dealer: { label: "โชว์รูมรถยนต์", icon: "🚗", tags: [["shop","car"]] },
    subway: { label: "รถไฟฟ้า BTS/MRT", icon: "🚇", tags: [["railway","station"],["station","subway"]] },
    bus_stop: { label: "ป้ายรถเมล์", icon: "🚌", tags: [["highway","bus_stop"]] },
    school: { label: "โรงเรียน", icon: "🏫", tags: [["amenity","school"]] },
    university: { label: "มหาวิทยาลัย", icon: "🎓", tags: [["amenity","university"]] },
    hospital: { label: "โรงพยาบาล", icon: "🏥", tags: [["amenity","hospital"]] },
    fuel: { label: "ปั๊มน้ำมัน", icon: "⛽", tags: [["amenity","fuel"]] },
    hotel: { label: "โรงแรม", icon: "🏨", tags: [["tourism","hotel"]] },
    cafe: { label: "ร้านกาแฟ", icon: "☕", tags: [["amenity","cafe"]] },
    restaurant: { label: "ร้านอาหาร", icon: "🍽️", tags: [["amenity","restaurant"]] },
    bank: { label: "ธนาคาร", icon: "🏦", tags: [["amenity","bank"]] },
    market: { label: "ตลาด", icon: "🛒", tags: [["amenity","marketplace"]] },
    park: { label: "สวนสาธารณะ", icon: "🌳", tags: [["leisure","park"]] },
  }
  ```
- Free-text: เพิ่ม `["name","~","<text>",i]` regex filter (case-insensitive) — จับได้ทั้ง "Central", "Toyota", "7-Eleven" ฯลฯ
- Haversine `distanceMeters(a, b)`

### 2.2 Server function: `src/lib/poi-search.functions.ts`
```ts
searchPOIsNearAssets({
  presetKeys: string[],      // multi-select
  freeText?: string,          // อาจเป็น null
  bbox: [s,w,n,e],           // จาก viewport ปัจจุบัน
  radiusM: 50|100|200|500|1000,
  matchMode: "any" | "all"   // ป้ายต้องใกล้ POI ใดๆ / ทุกประเภท
})
→ { pois: POI[], matches: { assetId, poiId, distanceM }[] }
```
- Query Overpass → parse → cross-join กับ assets (ต้องอยู่ใน bbox) → filter ≤ radiusM
- Cache react-query 30 นาที (key = filters + bbox rounded)

### 2.3 UI Component: `src/components/poi-proximity-panel.tsx`
- **Multi-Select Dropdown** — ใช้ Radix Popover + Command (shadcn `cmdk`) — มี checkbox หน้าแต่ละรายการ, มี search filter ในตัว dropdown, แสดง "เลือก 3 ประเภท" ที่ trigger
- **Free-text input** ด้านล่าง multi-select
- **Radius selector** — Radio group: 50 / 100 / 200 / 500 / 1000 ม.
- **Match mode toggle**: "ป้ายใกล้อย่างน้อย 1 ประเภท" / "ต้องใกล้ทุกประเภท"
- **ปุ่มค้นหา** + loading state
- **Results list** — collapsible cards ต่อ POI (คลิก → focus บนแผนที่)
- **Summary bar**: "พบ 24 POI · 47 ป้ายใกล้เคียง"
- **Export buttons**: CSV / PDF

### 2.4 เพิ่มโหมดในหน้า `/map`
- แก้ `src/routes/map.tsx`: เพิ่มปุ่มโหมด **"ค้นหาใกล้ POI"** (โหมดที่ 3) ข้าง Corridor / Inspection
- Integrate `PoiProximityPanel`
- ส่ง POI data ไป `AssetMap`

### 2.5 แก้ `src/components/asset-map.tsx`
- รับ props ใหม่: `poiMarkers[]`, `poiCircles?: { center, radius }[]`, `dimNonMatchingAssets?: Set<string>`
- Render POI markers (สีม่วง, icon ตาม preset)
- Render circles รัศมี รอบแต่ละ POI
- Dim ป้ายที่ไม่ match (เหมือน Corridor mode)

---

## Phase 3 — Enhancements
- **Save preset**: เก็บ query ที่ใช้บ่อยลง table ใหม่ `map_saved_poi_searches` (name, presetKeys[], freeText, radius, owner_id)
- **Add custom POI**: ปักหมุดเอง (ถ้า OSM ไม่มี) → table `custom_pois`
- **Export PDF**: rundown ป้าย + POI + แผนที่ snapshot (client-side ด้วย html2canvas + jsPDF)

---

## Order of Work

1. **Settings API tab** ← สร้างก่อน (คุณจะเห็นสถานะทันที)
2. **Overpass helper + ping**
3. **POI server function**
4. **POI panel UI (multi-select + free-text + radius)**
5. **Integrate เข้า /map เป็นโหมด 3**
6. **Save/export** (Phase 3)

ยืนยันเริ่มได้เลยไหม หรืออยากปรับ preset / radius ก่อน?
