# แผนคู่ขนาน: Phase A3 + Google Street View

## Phase A3 — Refactor payload → columns

เป้าหมาย: ให้ query ทั้งระบบใช้คอลัมน์จริง (`bkkupc`, `district`, `territory`, `location`, `media_type`) แทน `payload->>...` เพื่อ:
- ให้ index ใช้งานได้ → Monitoring / PM Insights / Health โหลดเร็วขึ้น
- ลดขนาด row ที่ดึง (ไม่ต้องยก JSON payload มาทั้งก้อน)

### ไฟล์ที่ต้องแก้

**1. `src/lib/data.functions.ts`** (จุดหลัก ใช้กันเยอะ)
- `select("... payload")` 4 จุด → เปลี่ยนเป็น select เฉพาะ `bkkupc, district, territory, location, media_type` + คอลัมน์ที่ใช้จริง
- อ่าน `payload.mediaType/MediaType/BKKUPC/District/...` → ใช้ `row.media_type / row.bkkupc / row.district`
- บรรทัดที่กระทบ: 288, 301, 315, 323, 391, 426, 435, 664
- คง fallback อ่าน payload ไว้ (กัน row เก่าที่ backfill ไม่ครบ) — priority: column ก่อน, payload หลัง

**2. `src/lib/monitoring.functions.ts`**
- Line 184, 200 — assets select payload → เปลี่ยน select
- Line 466 — `t.payload` เป็นจาก `mssql_asset_history` (คนละตาราง ไม่แตะ)
- Line 536, 538, 553 — `getMonitoringFilterOptions` — เปลี่ยนเป็น select column แล้วสร้าง set ตรง

**3. `src/lib/pm-insights.functions.ts`**
- Line 112, 113, 120, 128 — asset lookup select payload → select `department, bkkupc, media_type`
- Line 693, 695, 713 — zone map (`getPmZoneMap`) — เปลี่ยนเป็นอ่าน column, ลบ payload parsing

### ไม่ต้องแก้ (ยืนยัน)
- `src/components/breakdown-tab.tsx` — อ่าน `mssql_asset_history.payload` (คนละตาราง ไม่อยู่ใน scope A)
- `src/routes/pm-insights.tsx` line 425 — แค่ tooltip text
- `src/lib/overpass.ts`, `chart.tsx` — คนละความหมาย

### Validation
- typecheck ผ่านทุกไฟล์
- เปิด Monitoring / PM Insights / Search / Map — data ต้องยังตรง
- วัดเวลา: Asset Map ควรลดจาก ~5s → <2s

---

## Google Street View — Panorama ในหน้ารายละเอียดป้าย

เป้าหมาย: กดหมุดป้ายบนแผนที่ → เปิด `BillboardAnalyticsPanel` → มี **แท็บ / section "Street View"** แสดง panorama ณ พิกัดป้าย

### 1. เตรียม API key (ต้องคุณทำ)
- ใช้ **Google Maps Platform connector** (ผ่าน connector gateway) — Lovable-managed key
- Key นี้ถูก restrict ไว้เฉพาะ `*.lovable.app` / `*.lovableproject.com`
  → ทำงานบน preview / published URL ปกติได้เลย
  → ถ้าย้าย custom domain ต้องเพิ่ม key ของตัวเอง (ทำภายหลัง)
- ผมจะเรียก `standard_connectors--connect` เพื่อเชื่อม connector ให้อัตโนมัติ

### 2. Component ใหม่: `src/components/street-view-panel.tsx`
- โหลด Maps JS API แบบ async ด้วย `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY`
- เรนเดอร์ `google.maps.StreetViewPanorama` ใน `<div ref>` ขนาด 100% × 320px
- ใช้ `StreetViewService.getPanorama({ location, radius: 50 })` → ถ้าไม่มีภาพในรัศมี 50m แสดง "ไม่มีภาพ Street View บริเวณนี้"
- Controls: ปุ่ม fullscreen, pan/zoom (ของ Google เอง), ปุ่ม "เปิดใน Google Maps" (deep link `https://www.google.com/maps?q=&layer=c&cbll=lat,lng`)
- ปุ่ม refresh / reset heading

### 3. เสริมใน `src/components/billboard-analytics-panel.tsx`
- เพิ่ม tab / accordion section "Street View" (default: collapsed เพื่อไม่โหลด script ถ้าไม่กด)
- Lazy mount `<StreetViewPanel lat={asset.lat} lng={asset.lng} />` เมื่อกางเท่านั้น

### 4. Loader script (ครั้งเดียว)
- Utility `src/lib/google-maps-loader.ts` — return promise ที่ resolve เมื่อ `google.maps` พร้อม
- Callback global `__lovableInitGmaps` (idempotent)
- Guard: ถ้า `!import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` แสดง "ยังไม่ได้เชื่อม Google Maps connector"

### ข้อจำกัดที่ต้องรู้
- Street View ใน Thailand คลอบคลุมค่อนข้างดีในกรุงเทพ + เมืองใหญ่ แต่พื้นที่ห่างไกลอาจไม่มี
- Google Maps Platform บน Lovable managed key: fair-use free tier
- Custom domain (planb-asset360.lovable.app ตอนนี้ก็อยู่ใน *.lovable.app) → ใช้ได้เลย

---

## ลำดับส่ง
1. Refactor A3 (data + monitoring + pm-insights) — commit เดียว
2. เชื่อม Google Maps connector + Street View component + ใส่ใน panel
3. Verify: เปิด Asset Map วัดเวลา + คลิกป้าย → ต้องเห็น Street View
