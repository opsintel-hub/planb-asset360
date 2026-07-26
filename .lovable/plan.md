
# แผนการปรับปรุง Asset Map — Search + Billboard Popup

## กรณีที่ 1 — รวมการค้นหาให้เป็นระบบเดียว

**ปัญหาปัจจุบัน:** มี 3 จุดค้นหาซ้อนกัน (Old Code, สถานที่ Google Places, POI panel ที่มี Location + Free Text ในตัว) ทำให้ผู้ใช้สับสน

### แนวทาง: แยก "ค้นหา" ออกจาก "ตัวกรอง" อย่างชัดเจน

**A. Toolbar (บนสุด) — เหลือ 2 ช่องค้นหาที่หน้าที่ต่างกันชัดเจน**
1. `🔎 ค้นหาป้าย` — รวม Old Code + ชื่อ + จุดติดตั้ง (Location จากฐานข้อมูล) เป็นช่องเดียว มี autocomplete แยกกลุ่ม (ป้าย / จุดติดตั้ง) เมื่อเลือกจะ zoom เข้าหาป้ายหรือ cluster ของจุดติดตั้งนั้น
2. `📍 ค้นหาสถานที่` — Google Places (คงเดิม) สำหรับพิมพ์ห้าง/ถนน/ซอย

ตัวกรอง `Project / Media Type / เฉพาะที่กำลังซ่อม` คงไว้ที่ toolbar

**B. Panel ขวา (POI Search) — ตัดของซ้ำออก ให้เหลือหน้าที่เดียว**
- **ลบ** ช่อง "จุดติดตั้ง (Location)" และ "ค้นหาชื่อ (FREE TEXT)" ออกจาก panel (ย้ายไป toolbar แล้ว)
- **ลบ** BKK/UPC/District/Territory/Project/Media Type ที่ซ้ำกับ toolbar — ให้ POI ใช้ตัวกรองเดียวกับที่ toolbar ตั้งไว้แล้ว (ทำงานสอดคล้องกัน) 
- **เหลือเฉพาะ:** ประเภท POI (ร้านอาหาร/ห้าง/BTS…) + รัศมี + ปุ่มค้นหา
- เพิ่มปุ่ม toggle "ค้นเฉพาะในกรอบแผนที่ที่เห็น" (ค่าเริ่มต้น: เปิด) ให้ตรงกับพฤติกรรมที่ผู้ใช้คาดหวัง

ผลลัพธ์: panel POI จะเรียบขึ้นมาก เหลือ 3 ส่วน (ประเภท → รัศมี → ค้นหา) แทน 8+ กล่องเดิม

---

## กรณีที่ 2 — Billboard Popup

### 2.1 ปุ่มขยายเต็มจอสำหรับพื้นที่ Mockup
เพิ่มปุ่ม `⛶ Fullscreen` ที่หัว popup — เมื่อกดจะขยาย modal เป็น 100vw × 100vh, ให้ Street View + Mockup editor ใช้พื้นที่ทั้งหมด (คล้ายที่ทำใน `street-view-panel.tsx` อยู่แล้ว แต่ที่นี่ขยายทั้ง popup ไม่ใช่แค่ editor)

### 2.2 เพิ่มข้อมูล POI รอบป้าย (แบบหน้า Asset History)
เพิ่ม section `พื้นที่ใกล้เคียง (OSM)` ใน billboard popup — reuse component เดิมจาก `asset-street-view.tsx` / Asset History (component ที่ดึง Overpass API พร้อมรัศมี 100/200/500/1000 ม.)

**การใช้ credit:**
- ใช้ **Overpass (OSM) — ฟรี** ตัวเดียวกับ Asset History ไม่คิด credit
- Cache ผลลัพธ์ที่ client (react-query) — ถ้าคลิกป้ายเดิม/รัศมีเดิมซ้ำ ไม่ยิงใหม่
- โหลด **lazy on-demand** เฉพาะเมื่อผู้ใช้ขยาย section (accordion เริ่ม collapse) → ไม่ยิง API ทุกครั้งที่เปิด popup

### 2.3 นำ POI เข้า PPTX/PDF
เพิ่ม **สไลด์ที่ 2** ใน export (ไม่ทับสไลด์แรกที่ layout สวยแล้ว):
- **Slide 1:** Report เดิม (Street View + Mockup + Traffic + Demographics + POI Top 10)
- **Slide 2 (ใหม่):** "พื้นที่ใกล้เคียง (500 ม.)" — grid หมวดหมู่ตามภาพที่ 3 (ร้านอาหาร / ร้านกาแฟ / ป้ายรถเมล์ / ธนาคาร ฯลฯ) แต่ละหมวดแสดง top 6 + ระยะทาง

**Hyperlink ใน PPTX:** แต่ละรายชื่อ POI เป็น hyperlink → Google Maps (`https://www.google.com/maps/search/?api=1&query={lat},{lng}`) — เปิดใน browser เมื่อคลิกจาก PowerPoint/PDF ได้จริง

ใช้รัศมีที่ผู้ใช้เลือกอยู่ใน popup ตอน export (ไม่ต้อง fetch ซ้ำ — ส่งจาก state ที่โหลดไว้แล้วเข้า export function) → **ประหยัด credit** เพราะไม่ยิง API ซ้ำ

---

## ไฟล์ที่จะแก้

**กรณี 1:**
- `src/routes/map.tsx` — รวม search box ที่ toolbar, ปรับ state
- `src/components/poi-proximity-panel.tsx` — ลบส่วนซ้ำ, เพิ่ม toggle bbox
- ช่องค้นหาป้ายรวม (Old Code + Location) — ปรับที่ toolbar ใน `map.tsx`

**กรณี 2:**
- `src/components/billboard-analytics-panel.tsx` — ปุ่ม fullscreen, section POI (accordion)
- `src/lib/billboard-export.ts` — เพิ่ม slide 2 พร้อม hyperlink

## Credit / Performance
- POI ใน popup: Overpass ฟรี + cache + lazy
- PPTX slide 2: ใช้ข้อมูลที่โหลดแล้วใน popup (ไม่ยิงซ้ำ)
- ไม่ใช้ AI/Google API เพิ่มในฟีเจอร์เหล่านี้
