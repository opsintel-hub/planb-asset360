# Route Monitoring — แผนสร้างแบบ 6 Phase (ประหยัดเครดิต)

## สรุปคำตอบคำถามหลัก

**ต้องแยกเมนูใหม่ไหม?** ใช่ — สร้างเมนูใหม่ `/route-monitoring` แยกจาก Asset Map
เหตุผล: `src/routes/map.tsx` ตอนนี้ยาว ~1,800 บรรทัดและมี 3 โหมดอยู่แล้ว (POI / Corridor / Inspection) การยัดเพิ่มจะทำให้แก้ยากและเปลืองเครดิตทุกครั้งที่ต้องแก้ไฟล์ใหญ่ ส่วนหน้าใหม่จะ *reuse* ของเดิมทั้งหมด: `AssetMap`, `osrm.ts` (route/trip/GPX/KML), `map_saved_routes`, ตัวกรอง Project/Media/Zone

**ประหยัดเครดิตอย่างไร**
- คำนวณ K-Means + แบ่งวัน + Risk Score ทำใน **client/server function ธรรมดา ไม่เรียก AI model เลย** (เป็นคณิตศาสตร์ล้วน) → 0 credit ต่อการรัน
- OSRM เป็นบริการฟรี ไม่คิดเครดิต — แต่จะลดจำนวน request ด้วย debounce + cache ผลลง `map_saved_routes`
- ดึงป้ายจากที่โหลดอยู่บนแผนที่แล้ว (live filtered assets) ไม่ query ใหม่
- Risk Score ดึง claims 30–90 วันแบบ aggregate ครั้งเดียว (SQL group by asset) ไม่ดึง 353k rows มาที่ browser

## หน้าตาการใช้งาน

```text
[ Route Monitoring ]
Toolbar: Project(multi) | Media Type(multi) | Zone | จำนวนป้ายที่แสดง: 2,000 (auto)
Panel ซ้าย (Inputs):
  จำนวนพนักงาน [5]   กรอบเวลา (วัน) [3]
  จุดเริ่มต้น: [ใช้จุดกลางโซน / เลือกจากแผนที่ / คลังสินค้าที่บันทึกไว้]
  [ ] เหตุฉุกเฉิน: คนลา [1] คน
  [ Run Routing Plan ]
Panel ขวา: สรุปต่อคน/ต่อวัน (จำนวนป้าย, ระยะทาง, เวลาโดยประมาณ)
  → คลิกวัน = แสดงเส้นทางบนแผนที่ + รายการป้ายเรียงลำดับ
  Export: CSV / GPX / KML / Copy Google Maps URL
```

## Phase (แต่ละ Phase ใช้งานได้จริง ไม่ต้องรอ Phase ถัดไป)

**Phase 1 — โครงหน้าใหม่ + Inputs + Live Count**
เมนู/route ใหม่, sidebar item, แผนที่ + ตัวกรองเดิม (reuse), ฟอร์ม 4 ค่า (คน/วัน/จุดเริ่ม/toggle ฉุกเฉิน), แสดงจำนวนป้ายที่กรองได้แบบสด ยังไม่คำนวณเส้นทาง

**Phase 2 — Spatial Clustering (K-Means)**
`src/lib/route-planner.ts` (pure TS, ไม่มี dependency ใหม่): k-means บน lat/lng + ถ่วงให้จำนวนป้ายแต่ละโซนใกล้เคียงกัน แสดงโซนด้วยสีบนแผนที่ + ตารางสรุปต่อคน ยังไม่ยิง OSRM

**Phase 3 — แบ่งวัน + TSP Routing จริง**
แบ่งป้ายของแต่ละคนเป็น N วัน (แบ่งตามความใกล้กันเชิงพื้นที่ ไม่ใช่สุ่ม), ยิง OSRM `/trip` เป็นก้อนละ ≤100 จุด แล้วต่อกัน (ข้อจำกัด OSRM public), debounce 350ms, แสดง polyline + ลำดับหยุด + ระยะทาง/เวลา

**Phase 4 — บันทึก + Export**
บันทึกแผนลง `map_saved_routes` (reuse ตารางเดิม, เก็บ plan ทั้งชุดใน payload), โหลดแผนเก่ากลับมา, Export CSV/GPX/KML ต่อวัน/ต่อคน + Copy Google Maps URL (reuse `osrm.ts`)

**Phase 5 — Risk Score + Emergency Re-balance**
server function ใหม่: aggregate `claims` ย้อนหลัง 30/90 วัน → คะแนนความเสี่ยงต่อป้าย (มีเคลม 30 วัน = High, 0 เคลม 90 วัน = Low)
เมื่อเปิด toggle คนลา: เกลี่ยงานให้คนที่เหลือก่อน (Phase 1 re-balance) และแสดงชั่วโมงงาน/วันที่เพิ่มขึ้น

**Phase 6 — Priority Skipping + Auto-Promote Catch-up**
ถ้าเกลี่ยแล้วเกินเพดานชั่วโมง → ตัดป้าย Low-Risk ออกชั่วคราว, ป้ายที่ถูกข้ามบันทึกลงตารางใหม่ `route_skipped_assets` และถูกดันเป็น Priority 1 ในแผนรอบถัดไปโดยอัตโนมัติ + แผงสรุปสำหรับนำเสนอ (ประหยัดระยะทางกี่ %)

## รายละเอียดทางเทคนิค

- ไฟล์ใหม่: `src/routes/route-monitoring.tsx` (UI), `src/lib/route-planner.ts` (k-means + day split + risk, pure), `src/lib/route-planner.functions.ts` (server fn: risk aggregate, save/load plan)
- ไม่แก้ `src/routes/map.tsx` (ยกเว้นเพิ่มลิงก์เมนู) เพื่อลดความเสี่ยงและเครดิต
- OSRM: `/trip` รับสูงสุด ~100 พิกัด/คำขอ → chunk 90 จุด แล้วเชื่อมด้วย `/route` ระหว่างก้อน
- Risk Score: server function + SQL aggregate เท่านั้น (ไม่ดึง row ดิบมา client)
- DB: Phase 4 ใช้ `map_saved_routes` เดิม; Phase 6 เพิ่ม 1 ตารางพร้อม RLS + GRANT
- ไม่มีการเรียก AI model — คำว่า "AI Engine" ในเอกสารคืออัลกอริทึม geospatial ซึ่งรันฟรี

## ข้อควรตัดสินใจ (บอกได้ระหว่างทาง)
1. เวลาต่อป้าย/ความเร็วเฉลี่ย ใช้ค่าเริ่มต้น 5 นาที/ป้าย และเพดาน 8 ชม./วัน (ปรับได้ในหน้าตั้งค่า)
2. จุดเริ่มต้น: เริ่มจาก "จุดกลางของแต่ละโซน" ก่อน แล้วค่อยเพิ่มคลังสินค้าใน Phase 4
