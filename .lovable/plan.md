# แผนแก้ปัญหาโหลด/ค้นหา POI ช้า

สาเหตุที่ช้าตอนนี้: ทุก filter อ่านผ่าน `payload::jsonb` (`payload->>'District'` ฯลฯ) → Postgres ต้อง scan JSON ทั้ง 8,210 แถวทุกครั้ง ไม่มี index ใช้ได้ ต้องยกฟิลด์สำคัญขึ้นเป็นคอลัมน์จริง + สร้าง index

---

## Phase A — แตก payload เป็นคอลัมน์จริง (DB)

### A1. Migration
เพิ่มคอลัมน์ใน `public.assets`:
- `bkkupc text` (BKK / UPC)
- `district text` (เขต/อำเภอ)
- `territory text` (พื้นที่)
- `location text` (จุดติดตั้ง — ยกจาก payload; คงคอลัมน์ `area` เดิมไว้ไม่แตะ)
- `media_type text`

Backfill:
```sql
UPDATE public.assets SET
  bkkupc     = payload->>'BKKUPC',
  district   = payload->>'District',
  territory  = payload->>'Territory',
  location   = payload->>'Location',
  media_type = payload->>'MediaType';
```

Indexes:
- b-tree บน `bkkupc`, `district`, `territory`, `media_type`, `department`
- composite `(latitude, longitude)` สำหรับ bbox
- ไม่ index `location` (7,422 unique — เกือบ 1:1) ใช้ trigram สำหรับ typeahead แทน: `CREATE INDEX ON assets USING gin (location gin_trgm_ops)`

### A2. แก้ตัว sync ให้เขียนคอลัมน์ใหม่
2 จุด:
- `supabase/functions/sync-assets/index.ts` — เพิ่ม mapping `bkkupc/district/territory/location/media_type` จาก `item.BKKUPC` ฯลฯ
- `src/lib/sync.server.ts` — ถ้ามี path เขียน assets เพิ่ม mapping เดียวกัน

Guard: set เฉพาะเมื่อค่าไม่ว่าง (กัน sync ทับเป็น null); คง `payload` ทั้งก้อนไว้เพื่อ backward-compat

### A3. Refactor ทุกจุดที่อ่าน payload → อ่าน column
ไฟล์ที่พบว่าอ่าน `payload->>...` / `p.MediaType` / `p.Location` / `p.District`:
- `src/lib/map.functions.ts`, `map-store.functions.ts`, `data.functions.ts`, `admin.functions.ts`
- `src/lib/poi-search.functions.ts`, `billboard-analytics.functions.ts`
- `src/lib/monitoring*.ts`, `pm-insights.functions.ts`, `rca.functions.ts`
- `src/routes/search.tsx`, `map.tsx`, `pm-insights.tsx`, `settings.tsx`
- `src/components/breakdown-tab.tsx`, `analytics-tab.tsx`

เปลี่ยน `select payload` → `select bkkupc, district, territory, location, media_type, department, ...` เฉพาะฟิลด์ที่ใช้ (payload เดิมยังอยู่เป็น fallback)

รัน typecheck ครบทุกไฟล์ก่อน commit

---

## Phase B — เปลี่ยนตัวกรอง POI Panel

ที่ `src/components/poi-proximity-panel.tsx` — บล็อก "ตัวกรองพื้นที่":

**เอาออก:** ภาค (Region)

**ใส่ใหม่ (ตามลำดับ):**
1. **BKKUPC** — Segment toggle: ทั้งหมด · BKK · UPC (single select)
2. **District** — เขต/อำเภอ (multi-select)
3. **Territory** — พื้นที่ (multi-select)
4. **Location** — จุดติดตั้ง (combobox + typeahead search, ไม่ dump ทั้ง 7k)
5. **Department** — Static / Digital / Billboard / Airport / 7-Eleven ฯลฯ (multi-select)
6. **Media Type** — Cookies / 7-Eleven / Serie Pole ฯลฯ (multi-select)

ที่ `src/lib/poi-search.functions.ts`:
- `POIFilterOptions` เปลี่ยนเป็น `{ bkkupc, districts, territories, locations, departments, mediaTypes }`
- Query กรองจากคอลัมน์จริง (`.eq('bkkupc', ...)`, `.in('district', ...)` ฯลฯ) แทน `payload->>`
- คำนวณ bbox จากผลลัพธ์ที่กรองแล้ว → ยิง Overpass เฉพาะพื้นที่นั้น

Endpoint options ใหม่ `getPOIFilterOptions` return: `{ bkkupcs, districts, territories, departments, mediaTypes }` + typeahead endpoint สำหรับ Location

---

## Phase C — Progress popup > 3 วินาที

`src/components/search-progress-dialog.tsx`:
- `setTimeout(open, 3000)` หลังกดค้นหา
- Stage bar (เดินตามเวลาโดยประมาณ):
  1. กรองป้ายตามพื้นที่ (0–20%)
  2. คำนวณ bounding box (20–30%)
  3. เรียก Overpass API (30–90%)
  4. Match ระยะทาง (90–100%)
- ปุ่ม "ยกเลิก" ผ่าน `AbortController`
- Snap 100% เมื่อ response กลับ

Server fn stream ไม่ได้ → progress ใช้เวลาจริงฝั่ง client (estimated จากจำนวน POI types × พื้นที่ bbox)

---

## Risks
- **Sync ทับเป็น null**: กันด้วยการ set เฉพาะค่าที่ไม่ว่าง
- **หน้าอื่นพัง**: refactor A3 ทำใน commit เดียว + typecheck
- **Location typeahead**: 7,422 ค่า — ต้อง trigram index ไม่งั้นช้ากว่าเดิม

## ลำดับส่ง
1. **Phase A1** (migration) — รอ approve
2. **Phase A2 + A3** (sync + refactor call sites) — commit เดียว
3. **Phase B** (UI ตัวกรองใหม่ + endpoint)
4. **Phase C** (progress popup)

หลัง A2/A3 จะเร็วขึ้นชัดเจนแล้ว; B/C เป็น UX เสริม
