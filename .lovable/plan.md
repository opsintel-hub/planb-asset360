## เมนูใหม่: Asset Map (แผนที่ป้าย)

สร้างเมนู "แผนที่ป้าย" ใน sidebar โดยใช้ Leaflet + OSRM (ฟรี ไม่ต้องใช้ API key) ส่งมอบแบบ 3 เฟส

---

### เฟส 1 — Map + Filter + Claim Badge (ส่งก่อน)

**เมนูใหม่** `/map` เพิ่มใน `src/components/app-shell.tsx` (icon: MapPin)

**หน้า** `src/routes/map.tsx`
- โหลด assets ทั้งหมดที่มี lat/lng ผ่าน server fn ใหม่ `listAssetsForMap` ใน `src/lib/map.functions.ts` (คืน id, old_code, department, media_type, lat, lng, status)
- โหลดรายการ old_code ที่มี claim เปิดอยู่ ผ่าน server fn `listOpenClaimOldCodes` (reuse ตรรกะจาก `listClaims`)
- แสดง Leaflet map เต็มจอ (OpenStreetMap tiles) พร้อม `MarkerClusterGroup` เพื่อไม่ให้ค้างเมื่อหมุดเยอะ
- **สีหมุดตาม Department** (ใช้ divIcon SVG สีต่างกัน 11 สี ตาม `PROJECT_TO_DEPARTMENTS`)
- **Badge สีเหลืองมุมบนหมุด** เมื่อ old_code นั้นมีในรายการ claim ที่ยังเปิด (ใช้ divIcon ซ้อน)
- **Popup** เมื่อคลิกหมุด: old_code, department, media_type, status, ปุ่ม "ดู Asset History"
- **Filter Bar** ด้านบน: Department (multi), Media Type (multi), Project, ช่อง search old_code, toggle "เฉพาะที่กำลังซ่อม"
- **Legend** มุมล่างขวา: สี = department, ⚠️ = กำลังซ่อม
- **Stats แถบบน**: จำนวนหมุดที่แสดง / กำลังซ่อม

**เทคนิค TanStack Start**
- Leaflet เป็น browser-only library → หน้า `/map` ใช้ `React.lazy` โหลดคอมโพเนนต์แผนที่ ครอบด้วย `<ClientOnly>` เพื่อไม่ให้ SSR crash
- Route ตั้ง `head()` มี title/description เฉพาะ

**Dependencies**: `bun add leaflet react-leaflet leaflet.markercluster @types/leaflet`

---

### เฟส 2 — ลากเส้นทาง + ค้นป้ายในรัศมี + Export

- เพิ่ม tab "ค้นตามเส้นทาง" ในหน้า `/map`
- ใช้ `leaflet-draw` (หรือวาด polyline เอง) ให้ผู้ใช้คลิกจุดต่อจุดบนแผนที่เพื่อสร้างเส้นทาง
- Slider เลือกรัศมี: 50 / 100 / 200 / 500 ม. (custom ได้)
- คำนวณระยะจากป้ายถึงเส้น polyline (Haversine + จุด-ต่อ-segment) ทำฝั่ง client จากข้อมูล assets ที่โหลดไว้แล้ว
- ตาราง "ป้ายในรัศมี" เรียงตามลำดับตามเส้นทาง แสดง old_code, department, ระยะห่าง (m), สถานะซ่อม
- **Export CSV/Excel** (ใช้ SheetJS) และ **Export GeoJSON** ของเส้นทาง + ป้าย
- ปุ่ม "บันทึกเส้นทาง" → เก็บลงตาราง `saved_routes` (ดูตารางใหม่ด้านล่าง)

---

### เฟส 3 — Route Planner ต้นทาง→ปลายทาง (งานตรวจสื่อ)

- tab "วางแผนตรวจสื่อ"
- **จัดการต้นทาง Default** (CRUD) — ทั้ง **Shared** (admin สร้าง ทุกคนใช้) และ **Per-user** (ของตัวเอง) ในตารางเดียว มี field `is_shared`
- ฟอร์ม: เลือกต้นทาง (จาก default หรือปักบนแผนที่), เลือกป้ายปลายทางหลายป้าย (คลิกบนแผนที่ / search / เลือกจาก filter)
- 2 โหมด:
  - **Manual**: ผู้ใช้กำหนดลำดับเอง (drag reorder)
  - **Auto**: เรียกใช้ OSRM `/trip` service (nearest-neighbor TSP ฟรี) เพื่อหาลำดับที่เร็วที่สุด
- OSRM ใช้ public demo server (`router.project-osrm.org`) — ใส่ note ให้ผู้ใช้ทราบข้อจำกัด rate limit ในเอกสาร
- แสดงเส้นทางจริง (route polyline) บนแผนที่ + รายการลำดับป้าย + ระยะทาง/เวลาโดยประมาณ
- **บันทึกแผนงาน** ลงตาราง `saved_routes`
- **Export**: CSV (ลำดับ, old_code, department, address, lat, lng, ETA), และลิงก์เปิด Google Maps navigation

---

### ข้อ 4 — คำแนะนำเพิ่มเติม (เลือกทำภายหลัง)

- **Heatmap layer** สลับเปิด แสดงความหนาแน่นของ claim/PM fail รายพื้นที่ → เห็น hotspot ปัญหา
- **Cluster โดย department** พร้อม donut chart ในไอคอน cluster
- **แชร์ลิงก์** เส้นทางที่บันทึก (URL param encode)
- **Realtime claim badge** — subscribe Supabase realtime บน `claim_tickets` เพื่อขึ้น ⚠️ ทันทีเมื่อมี claim ใหม่
- **Offline print view** — หน้าพร้อมพิมพ์สำหรับทีมภาคสนาม

---

### เทคนิค (Database & Backend)

**ตารางใหม่** (migration แยก ทำตอนเข้าเฟส 2/3):
- `map_default_origins` — id, user_id (nullable = shared), name, lat, lng, address, is_shared, created_at
- `saved_routes` — id, user_id, name, kind ('corridor' | 'inspection'), origin jsonb, waypoints jsonb, radius_m, polyline text, created_at, updated_at
- ทั้ง 2 ตารางเปิด RLS: อ่าน = shared OR own, เขียน = own (shared เขียนได้เฉพาะ admin)
- GRANT + policies ครบตามมาตรฐาน

**เมนู access control** — เพิ่ม `/map` ลง `NAV_ALL` และเข้ากับระบบ `getMyMenuAccess` ที่มีอยู่แล้ว

---

### ลำดับส่งมอบ

จะเริ่มจาก **เฟส 1** ก่อนตามที่ตอบไว้ (แผนที่ + filter + claim badge) เมื่อ user รีวิว OK ค่อยต่อเฟส 2 และ 3 ทีละเฟส
