
## เป้าหมาย
ย้ายข้อมูลป้าย + Analytics + POI ใกล้เคียง (แบบเดียวกับหน้า Asset History) มาไว้ใน Asset Map โดยเปลี่ยนจาก popup เล็ก ๆ เป็น **Side Drawer เต็มความสูง** ที่เปิดจากด้านขวา ไม่บังแผนที่มากเกินไป และใช้งานสะดวก

## UX ที่เสนอ

### 1. Side Drawer แทน Popup
- คลิกหมุดป้ายบนแผนที่ → เปิด Drawer ด้านขวา (กว้าง ~640px, เต็มความสูงหน้าจอ; mobile = เต็มจอ)
- แผนที่ยังคงเห็นด้านซ้าย (ผู้ใช้สลับดูป้ายอื่นได้โดยไม่ต้องปิด Drawer)
- ปุ่มปิด (X) + ปุ่ม "ดูประวัติป้าย →" ไปหน้า Search
- ไม่ใช้ Leaflet popup อีกต่อไปสำหรับป้าย (คลิก → เปิด Drawer)

### 2. โครงสร้างในเน้น Drawer (3 แท็บ)
```text
┌─ Header ───────────────────────────────┐
│ S-CPLK-2   [ดูประวัติ →]           [X] │
│ สี่แยกยศเส-ร ถ.ธรรมบูชา              │
│ Dept · Media · Status                  │
├─ Tabs ─────────────────────────────────┤
│ [ภาพรวม] [Analytics] [POI ใกล้เคียง]   │
├────────────────────────────────────────┤
│ (เนื้อหาตามแท็บ)                       │
└────────────────────────────────────────┘
```

- **ภาพรวม**: ข้อมูลพื้นฐาน (Dept/Media/Location/Status) + ปุ่ม PPTX/PDF + Copy link พิกัด + คำเตือนเคลม
- **Analytics**: เหมือน `BillboardAnalyticsPanel` เดิม (Traffic, ประชากร, ช่วงเวลาหนาแน่น) — โหลด lazy
- **POI ใกล้เคียง**: โครงเดียวกับหน้า Search Profile
  - Pills รัศมี: 100 / 200 / 500 / 1000 ม.
  - Grid หมวดหมู่ (ร้านอาหาร/ร้านกาแฟ/ป้ายรถเมล์/…)
  - แต่ละ POI มีปุ่ม Copy Link (Google Maps URL) ✓ ตามที่ผู้ใช้ชอบ
  - โหลด **เฉพาะเมื่อผู้ใช้กดแท็บนี้** (lazy) — กัน rate limit Overpass

### 3. Cache & Performance
- Cache POI ต่อ asset (React Query staleTime 10 นาที) — ปิด/เปิด Drawer ซ้ำไม่โหลดใหม่
- Analytics ใช้ query key เดิมของ `BillboardAnalyticsPanel`
- ปิด Drawer / เลือกป้ายใหม่ = state ของแท็บก่อนหน้าค้างไว้ใน cache

## รายละเอียดทางเทคนิค

### ไฟล์ใหม่
- `src/components/asset-map-drawer.tsx`
  - Props: `asset: MapAsset | null`, `open: boolean`, `onClose: () => void`
  - ใช้ `<Sheet>` (shadcn) side="right" width `sm:max-w-[640px]`
  - Tabs (shadcn) 3 แท็บ พร้อม lazy mount แท็บ POI
  - Reuse: `BillboardAnalyticsPanel` (Analytics tab)
  - Reuse: logic POI จาก `src/routes/search.tsx` (แยกเป็น sub-component ใหม่ `nearby-poi-section.tsx` เพื่อ share ระหว่าง Search + Map)

### ไฟล์ใหม่ (แยก POI section ให้ reuse ได้)
- `src/components/nearby-poi-section.tsx`
  - Props: `assetId`, `lat`, `lng`
  - รัศมี pills, grouping, copy-link buttons
  - ใช้ `getNearbyPOIsForAsset` เดิม (จาก `src/lib/poi-search.functions.ts`)
- Refactor `src/routes/search.tsx` ให้ใช้คอมโพเนนต์นี้แทนโค้ด inline (ลดความซ้ำ)

### แก้ไข `src/routes/map.tsx`
- เพิ่ม state `selectedMapAsset` (แทน/เสริมของเดิมที่เปิด BillboardAnalyticsPanel modal)
- ส่ง `onSelectAsset` เข้า `<AssetMap>` เหมือนเดิม แต่เปิด Drawer แทน modal Analytics เดิม
- ปุ่ม PPTX/PDF ย้ายจาก header modal → tab "ภาพรวม" ของ Drawer

### แก้ไข `src/components/asset-map.tsx`
- ไม่ต้องแก้ — `onSelectAsset` มีอยู่แล้ว, ปิด `bindPopup` เมื่อมี `onSelectAsset` ก็ทำอยู่แล้ว

## จุดที่ตัด/ปรับ (เพื่อ layout สะอาด)
- ตัด Leaflet popup ของป้ายทิ้ง (ซ้ำกับ Drawer)
- Analytics modal เดิม (`BillboardAnalyticsPanel` แบบ full-screen) → ยุบเข้า Drawer tab แทน
- ยัง keep ปุ่ม PPTX/PDF, คำเตือนเคลม, ลิงก์ไปหน้า Search

## สิ่งที่ผู้ใช้จะได้
1. คลิกป้าย → Drawer ใหญ่ อ่านง่าย
2. เห็นแผนที่พร้อมกันตลอด (ยังคลิกป้ายอื่นได้)
3. POI ใกล้เคียง + Copy link ครบเหมือนหน้า Search
4. ประหยัด API — POI โหลดเฉพาะเมื่อกดแท็บ, cache 10 นาที
