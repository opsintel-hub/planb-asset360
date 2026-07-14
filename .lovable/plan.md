
## ตอบคำถามข้อ 1 (ที่มาของข้อมูล Analytics)

ข้อมูลในภาพที่ 1 (Traffic score, Demographics %, Peak hours, POI buckets, Impressions/day) **ไม่ได้มาจาก AI** — คำนวณด้วย heuristic ในไฟล์ `src/lib/billboard-analytics.functions.ts` โดยดึงข้อมูลจริงจาก **OpenStreetMap (Overpass API)** รอบพิกัดป้ายในรัศมีที่เลือก แล้วใช้สูตรถ่วงน้ำหนัก:

- **POI buckets** → ค้นหา node/way ที่มี tag เช่น `shop`, `amenity`, `office`, `tourism`, `railway=station` แล้วจัดกลุ่มเป็น 11 หมวด (ร้านค้า, ออฟฟิศ, โรงเรียน, ฯลฯ)
- **Demographics %** → หมวด POI แต่ละหมวดมีน้ำหนักผูกกับกลุ่มเป้าหมาย (เช่น mall = shopper×5, school = student×5) แล้ว normalize เป็น %
- **Traffic score** → น้ำหนักตามคลาสถนน (motorway=40, primary=28, ...) + โบนัสความหนาแน่น POI
- **Peak hours** → mapping ตายตัวจากกลุ่ม dominant (office → 07:30-09:30, 17:00-19:00 ฯลฯ)
- **Impressions/day** → `trafficScore × 200` ถึง `× 600`

**ปรับแต่งค่าได้ไหม?** ตอนนี้ค่าน้ำหนักทั้งหมดเป็น constant ในโค้ด (`BUCKETS`, `ROAD_WEIGHT`, `peaksFor`) — จะเพิ่มหน้า **Settings → Analytics Weights** ให้ปรับได้ (คล้ายกับ AI Prompt Settings ที่ทำไว้แล้ว) โดยเก็บ override ใน `app_settings` key = `analytics_weights` และ merge กับ default ตอนรัน

## ข้อ 2 — จัดใหม่ Layout PPTX/PDF (สไลด์เดียว โปร่ง อ่านง่าย)

ปัญหาปัจจุบัน: กล่องขวาแออัด, POI list ไม่มีเลย, ข้อมูลชนกัน

Layout ใหม่ (LAYOUT_WIDE 13.33" × 7.5"):

```text
┌─────────────────── Header bar (h=0.6, สี BRAND) ─────────────────────┐
│  Billboard Report · 7810 — LOCAL ROAD          14/7/2569  09:53      │
├──────────────────────────────────────────┬──────────────────────────┤
│                                          │ ┌── ข้อมูลป้าย ─────────┐ │
│                                          │ │ 7 rows (native text) │ │
│   Hero (Street View + Mockup)            │ └──────────────────────┘ │
│   x=0.3  y=0.9  w=7.6  h=4.3             │ ┌── Analytics KPI ─────┐ │
│                                          │ │ Traffic  Impressions │ │
│                                          │ │  80/100  14,400-...  │ │
│                                          │ │ สูงมาก   ไม่พบถนน    │ │
│                                          │ └──────────────────────┘ │
│  Street View + Ad Mockup (caption)       │ ┌── กลุ่มเป้าหมาย ─────┐ │
├──────────────────────────────────────────┤ │ นักช้อป 53% ▓▓▓▓▓░  │ │
│  POI รอบป้าย (20 แห่ง)     ช่วงพีค:      │ │ ที่อยู่  23% ▓▓░░░░  │ │
│  ┌───────────────┬───────────────────┐   │ │ นักเรียน 14% ▓░░░░░  │ │
│  │ 🛍️ ร้านค้า 14 │ 📚 รร./มหาลัย  2  │   │ └──────────────────────┘ │
│  │ 🍽️ ร้านอาหาร2│ 🏬 ห้าง         1  │   │                          │
│  │ 🗺️ ท่องเที่ยว1│                    │   │                          │
│  └───────────────┴───────────────────┘   │                          │
│                                          │                          │
│  POI ที่ใกล้ที่สุด (top 10) — 2 คอลัมน์ │                          │
│  1. 7-Eleven 7810     ร้านค้า      9 ม. │                          │
│  2. Jai Dee kitchen   ร้านอาหาร   98 ม. │                          │
│  3. Moca cafe         ร้านค้า    159 ม. │                          │
│  ... (แบ่ง 2 คอลัมน์)                   │                          │
└──────────────────────────────────────────┴──────────────────────────┘
  Footer (h=0.3): สร้างเมื่อ ... · Asset History 360 · แก้ไขได้ทุกกล่อง
```

**หลักการโปร่ง:**
- เพิ่ม whitespace ระหว่างกล่อง (gap 0.15")
- Card แต่ละใบมีขอบบางสี BORDER + background ขาว
- ตัวเลข KPI ใหญ่ 22-28 (Traffic, Impressions) เน้น hierarchy
- POI top 10 แสดง 2 คอลัมน์ (5+5) หรือ 3 คอลัมน์เมื่อชื่อสั้น
- POI Buckets ใช้ grid 2 คอลัมน์ + bar สีตามหมวด แทนที่จะเรียงเป็นแถวเดียวยาว
- Demographics ทำเป็น bar list พร้อม % ชิดขวา แทน inline text

## รายการไฟล์ที่จะแก้

1. **`src/lib/billboard-export.ts`**
   - เขียน `exportBillboardPptx` ใหม่ตาม layout ด้านบน (native pptxgen เพื่อยัง edit ใน PowerPoint ได้)
   - เพิ่ม section POI Top 10 (2 คอลัมน์) + POI Buckets grid 2 คอลัมน์
   - แยก Demographics เป็น bar list แนวตั้ง
   - เขียน `exportBillboardPdf` ใหม่ให้ layout ตรงกับ PPTX (ใช้ jsPDF + image snapshots สำหรับข้อความไทย)

2. **`src/lib/analytics-weights-defaults.ts`** (สร้างใหม่)
   - แยก `BUCKETS`, `ROAD_WEIGHT`, `PEAK_HOURS`, `IMPRESSION_MULTIPLIER` ออกจาก `billboard-analytics.functions.ts`
   - export default constants + type

3. **`src/lib/billboard-analytics.functions.ts`**
   - import default weights, โหลด override จาก `app_settings` key `analytics_weights` (คล้ายที่ ai-analyze ทำ), merge แล้วใช้แทน constant
   - ปลอดภัยกับกรณีที่ยังไม่มี row → fallback default

4. **`src/components/analytics-weights-settings.tsx`** (สร้างใหม่)
   - UI form ให้ admin ปรับ:
     - น้ำหนัก demographics per bucket (input 0-10)
     - ROAD_WEIGHT per class (input 0-50)
     - IMPRESSION_MULTIPLIER min/max (default 200/600)
     - Peak hours per demographic (2 input string per กลุ่ม)
   - ปุ่ม Reset per section + Save (บันทึกเข้า `app_settings`)

5. **`src/routes/settings.tsx`**
   - เพิ่ม tab **"Analytics"** (admin only) ต่อจาก tab AI Prompt

## รายละเอียดทางเทคนิค

- `app_settings` schema เดิมมีอยู่แล้ว (key/value jsonb) — ไม่ต้อง migration
- Server function ใหม่: `getAnalyticsWeights` + `updateAnalyticsWeights` (require admin, ใน `src/lib/analytics-weights.functions.ts`)
- Cache override ในหน่วยความจำ 60s เพื่อลด DB round-trip ต่อทุก analyze call
- PPTX: text ทุกกล่องยัง native (`s1.addText`) เพื่อลูกค้าดับเบิลคลิกแก้ได้
- PDF: ใช้ pattern เดิม (html2canvas-pro snapshot per block) เพื่อรองรับ font ไทย
