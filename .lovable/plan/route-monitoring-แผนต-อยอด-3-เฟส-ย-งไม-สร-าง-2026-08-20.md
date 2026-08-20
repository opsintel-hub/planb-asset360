# Route Monitoring — แผนต่อยอด 3 เฟส (ยังไม่สร้าง)

ทั้ง 3 เฟสเป็นคณิตศาสตร์/สตริงล้วน ไม่เรียก AI model และไม่เพิ่มค่า API — ใช้ OSRM ฟรีเท่าเดิม

---

## เฟส A — เพดานชั่วโมงจริง + ตัดป้ายเสี่ยงต่ำอัตโนมัติ + ดันเป็นคิวแรกรอบถัดไป

**พฤติกรรมที่จะได้**
- หลัง Run Routing Plan ระบบตรวจทุก "คน-วัน" ว่าเวลารวม (ตรวจ + เดินทางจริงจาก OSRM) เกินเพดาน ชม./วัน หรือไม่
- ถ้าเกิน: ตัดป้าย **Low risk** ออกจากวันนั้นทีละใบ (เอาใบที่ไกลจากเส้นทางที่สุดออกก่อน) จนกลับเข้าเพดาน
  - ถ้าตัด Low หมดแล้วยังเกิน → ตัด Medium ต่อ พร้อมเตือนสีแดงว่า "งานเกินกำลัง ควรเพิ่มคน/วัน"
  - ไม่ตัดป้าย High risk เด็ดขาด
- สวิตช์ "ตัดอัตโนมัติเมื่อเกินเพดาน" (เปิดเป็นค่าเริ่มต้น) — ปิดได้ถ้าต้องการเห็นแผนดิบ
- แผงใหม่ "ป้ายที่ถูกเลื่อน (N)" แสดงรายการที่ถูกตัด + เหตุผล + ปุ่มบันทึกเข้าคิว
- รอบถัดไป: เมื่อกด Run ระบบดึงคิวค้างมาใส่เป็น **Priority 1** — ป้ายเหล่านี้ถูกล็อกไว้ในวันแรกของแต่ละคนและห้ามถูกตัดซ้ำ พร้อมป้ายกำกับ "ค้างจากรอบก่อน"

**ตารางใหม่** `public.route_deferred_assets`
- คอลัมน์: `id`, `asset_old_code`, `plan_name`, `inspector_index`, `day_index`, `reason`, `risk_level`, `deferred_at`, `cleared_at`, `created_by`
- GRANT authenticated (SELECT/INSERT/UPDATE/DELETE) + service_role ALL, RLS: เห็น/แก้ได้เฉพาะแถวของตัวเอง หรือ admin/manager
- server functions ใหม่ใน `src/lib/route-deferred.functions.ts`: `listDeferredAssets`, `saveDeferredAssets`, `clearDeferredAssets`

**โค้ดที่แตะ**
- `src/lib/route-planner.ts`: เพิ่ม `trimToHourCap()` (pure) และ `pinPriorityFirst()`
- `src/routes/route-monitoring.tsx`: สวิตช์ + แผงป้ายที่ถูกเลื่อน + เรียกใช้คิวค้าง
- `src/lib/route-plan-export.ts`: payload v2 เก็บ `deferred` และ `priorityCodes`

---

## เฟส B — คลังสินค้า/จุดตั้งต้นจริงต่อทีม + ใส่ชื่อช่างต่อรูท

**พฤติกรรมที่จะได้**
- โหมดจุดเริ่มใหม่ "ต่อทีม (Per-team depot)" เพิ่มจากเดิม (centroid / saved / pin)
- ตารางรายชื่อทีมในแผงซ้าย: แถวละ 1 คน → ช่อง **ชื่อช่าง** + **จุดตั้งต้น** (เลือกจากคลังที่บันทึกไว้ / ปักหมุด / ใช้จุดกลางโซน) + จุดสิ้นสุด (ค่าเริ่มต้น = กลับจุดตั้งต้น)
- ชื่อช่างแสดงแทน "คนที่ 1/2/3" ทุกที่: แผงสรุป, การ์ดวัน, ป๊อปอัปบนแผนที่, CSV/GPX/KML, ชื่อไฟล์ export
- การจัดโซนคำนึงถึงจุดตั้งต้นจริง: ปักหมุดคลังของแต่ละคนเป็นเมล็ดตั้งต้น (seed) ของ K-Means แทนการสุ่ม → คนที่คลังอยู่ธนบุรีได้โซนฝั่งธนบุรี
- คลังใช้ตารางเดิม `map_saved_locations` (มี `is_shared` อยู่แล้ว) — ไม่สร้างตารางใหม่
- รายชื่อช่าง + คลังต่อคน ถูกบันทึกไปกับแผนใน `map_saved_routes` และโหลดกลับได้

**โค้ดที่แตะ**
- `src/lib/route-planner.ts`: `clusterBalanced` / `clusterFairHours` รับ `seeds?: LatLng[]`
- `src/lib/route-plan-export.ts`: payload เพิ่ม `teams: { name, depotId, depot, endDepot }[]`
- `src/routes/route-monitoring.tsx`: ตารางทีม + ส่ง seeds เข้า planner + ใช้ depot ต่อคนตอนยิง OSRM (แทน `startPoint` ตัวเดียว)
- แยกตารางทีมเป็นคอมโพเนนต์ใหม่ `src/components/route-team-table.tsx` กันไฟล์หลักบวม

---

## เฟส C — ส่งแผนเข้า Google Maps / แอปมือถือช่างโดยตรง

**พฤติกรรมที่จะได้**
- ปุ่มต่อวันต่อคน:
  - **เปิดใน Google Maps** — สร้าง `https://www.google.com/maps/dir/?api=1&origin=..&destination=..&waypoints=..` เรียงตามลำดับที่ optimize แล้ว (จำกัด 9 waypoint/ลิงก์ → ตัดเป็น "ช่วงที่ 1/2/3" อัตโนมัติ)
  - **คัดลอกลิงก์** / **QR Code** — ช่างสแกนจากจอ เปิดในมือถือได้ทันที ไม่ต้องล็อกอิน
  - **ส่งทาง LINE** — `https://line.me/R/msg/text/?` พร้อมข้อความสรุป (ชื่อช่าง, วัน, จำนวนป้าย, ระยะทาง, ลิงก์)
  - **GPX / KML** ต่อวัน (มีอยู่แล้ว) + ใหม่: **KML รวมทั้งแผน** เปิดใน Google Earth / My Maps
- ลิงก์แชร์แบบอ่านอย่างเดียวสำหรับช่าง: `/shared/route/<token>` แสดงลำดับป้าย + ระยะทาง + ปุ่มนำทางต่อจุด ไม่ต้องล็อกอิน ใช้กลไก token เดิมแบบ `poi_shares` (ตารางใหม่ `route_shares` หรือขยาย `poi_shares` — จะเลือกขยาย `poi_shares` ถ้าโครงสร้าง payload รองรับ เพื่อประหยัด)
- ไม่ใช้ Google Directions API (มีค่าใช้จ่าย) — เป็นลิงก์ deep link ล้วน

**โค้ดที่แตะ**
- `src/lib/route-share.ts` (ใหม่, pure): สร้างลิงก์ Google Maps แบบแบ่งช่วง + ข้อความ LINE
- `src/lib/route-plan-export.ts`: KML รวมทั้งแผน
- `src/routes/route-monitoring.tsx`: แถวปุ่มส่งงาน
- `src/routes/shared/route.$token.tsx` (ใหม่) + server fn สร้าง/อ่าน token

---

## หมายเหตุการทำงาน
- ลำดับแนะนำ A → B → C (A ไม่ต้องรอ B; C ได้ประโยชน์เต็มที่หลัง B เพราะมีชื่อช่างแล้ว)
- แต่ละเฟสใช้งานได้จริงจบในตัว ไม่ต้องรอเฟสถัดไป
- ต้นทุน: ไม่มี AI, ไม่มี API ใหม่ที่คิดเงิน — เพิ่มเฉพาะ DB 1 ตาราง (เฟส A) และ token 1 ตาราง/ขยาย (เฟส C)
