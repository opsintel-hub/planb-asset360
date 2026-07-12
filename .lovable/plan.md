# Roadmap — ฟีเจอร์ขั้นสูงของแผนที่ป้ายโฆษณา

สถานะ ณ ตอนนี้ (Phase 1–2 เสร็จแล้ว) และแผนต่อไป (Phase 3–6)

---

## ✅ Phase 1 — API Settings UI  (เสร็จแล้ว)
หน้า `/settings` → tab **"External APIs"**
- Overpass (OSM) · OSRM · Nominatim → ปุ่มทดสอบการเชื่อมต่อ + latency
- Google Maps / Street View → ช่องกรอก API Key (ยังไม่บังคับ)

ไฟล์: `src/components/external-apis-section.tsx`, `src/lib/external-apis.functions.ts`

---

## ✅ Phase 2 — POI Proximity Search  (เสร็จแล้ว)
หน้า `/map` → โหมดที่ 3 **"ค้นหาใกล้ POI"**
- Multi-select 15 ประเภท (ห้าง / โชว์รูม / BTS-MRT / ป้ายรถเมล์ / โรงเรียน ฯลฯ)
- Free-text ค้นชื่อ (Central, Toyota, 7-Eleven ...)
- รัศมี 50 / 100 / 200 / 500 / 1000 ม.
- Match mode: any / all
- แสดง pin POI + วงกลมรัศมี + dim ป้ายที่ไม่อยู่ในระยะ
- Export CSV

ไฟล์: `src/lib/overpass.ts`, `src/lib/poi-search.functions.ts`, `src/components/poi-proximity-panel.tsx`

---

## 🔜 Phase 3 — Billboard Analytics Popup  (ถัดไป)
คลิกป้ายบนแผนที่ → panel ด้านขวาแสดง:
- ข้อมูลประชากรจำลอง (พนักงานออฟฟิศ %, นักศึกษา %, ...) — ประเมินจาก POI รอบข้าง
- Traffic score จำลอง (Low / Med / High) จากจำนวน POI + ประเภทถนน (OSM highway tag)
- Peak hour สมมติตามพื้นที่ (ออฟฟิศ ↔ ห้าง ↔ ที่อยู่อาศัย)

*ทั้งหมดเป็น mock ที่คำนวณจากข้อมูล OSM ฟรี ไม่มีค่าใช้จ่าย*

---

## 🔜 Phase 4 — Street View + Mockup Overlay
- Embed Google Street View (ใช้ key ที่กรอกไว้ใน Phase 1) fallback = Mapillary (ฟรี)
- Upload PNG/JPG → วางทับกรอบป้ายจำลอง
- ปรับตำแหน่ง/ขนาด/มุม แบบ manual (drag / resize / rotate)

---

## 🔜 Phase 5 — Export PDF Report
รวมทุกอย่างในหน้าเดียว: รายละเอียดป้าย + Analytics + Street View snapshot + Mockup
Client-side ด้วย `jspdf` + `html2canvas` (ไม่มีค่า API)

---

## 🔜 Phase 6 — Enhancements
- Save POI search presets (ตาราง `map_saved_poi_searches`)
- ปักหมุด POI เอง (ตาราง `custom_pois`)
- PDF export สำหรับ POI search
