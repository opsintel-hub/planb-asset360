# POI Search — 4 การปรับปรุงในรอบเดียว

หลักการ: ใช้ตัวกรอง Project/Media Type ที่ **มีอยู่แล้ว** บน toolbar แผนที่ให้ทำงาน 2 ชั้น (ก่อน+หลังค้นหา) โดยไม่สร้าง UI ซ้ำ

---

## 1. CSV — เพิ่ม Media Type/Department/Project
เพิ่ม 3 คอลัมน์ใหม่ต่อจาก `Asset Name`:
```
Asset (Old Code) | Asset Name | Media Type | Department | Project | ระยะ (m)
```
ข้อมูลดึงจาก `assetIndexById` ที่จะขยายให้เก็บ `department` + `media_type` (ไม่มี round-trip เพิ่ม).

## 2. Pre-search filter (ทำให้ Overpass เร็วขึ้น/timeout น้อยลง)
Toolbar เดิมมี `Project` และ `Media Type` selectors อยู่แล้ว — **ส่งค่านี้ลงไปที่ server function** (parameter `departments` + `mediaTypes` มีรองรับแล้วใน `searchPOIsNearAssets`):
- Server จะกรอง assets จำนวนน้อยลงตั้งแต่ต้น
- bbox หลังกระชับ (tightBbox) จะเล็กลง → Overpass query เร็ว/สำเร็จมากขึ้น
- ไม่ต้องเพิ่ม UI ใหม่เลย เพียงต่อสาย

แสดง badge เล็กบนหัวการ์ด POI panel เพื่อบอกผู้ใช้ว่า “กำลังค้นหาเฉพาะ: Digital / LED” เพื่อความชัดเจน.

## 3. Post-search chip filter (สลับดูทีละกลุ่ม)
เมื่อผลลัพธ์กลับมา จะสร้าง chip filters อัตโนมัติจาก matched assets:
- Row 1: Project chips (Digital / Static / Billboard / …) พร้อมจำนวน
- Row 2: Media Type chips พร้อมจำนวน

กด chip = toggle → กรอง client-side ทันที (ไม่ยิงเซิร์ฟเวอร์ซ้ำ), รายการ POI/asset ใต้ผลลัพธ์และวงกลมบนแผนที่ถูก filter ตาม.

### 3.1 ผลกระทบกับ Export
ปุ่ม `CSV ▾` เปลี่ยนเป็น dropdown 2 ตัวเลือก:
- **เฉพาะที่กรองอยู่ตอนนี้** (default — สอดคล้องกับที่ผู้ใช้เห็น)
- **ทั้งหมดที่ค้นเจอ**

### 3.2 pre + post = ครอบคลุมทั้งความเร็วและความสะดวก
Pre-filter (ข้อ 2) ลดโหลด Overpass; Post-filter (ข้อ 3) ให้ผู้ใช้สลับมุมมองกลุ่มโดยไม่ต้อง search ใหม่.

## 4. Shareable Locked Link
- ปุ่มใหม่ `แชร์ลิงก์` ในหัวการ์ดผลลัพธ์ POI
- Encode ลง URL search params: `presets`, `q`, `radius`, `bbox`, `project`, `media`, chip filter, และ `lock=1`
- Copy URL ไป clipboard
- เมื่อเปิดลิงก์ที่มี `lock=1`:
  - Auto-รัน POI search ตาม state ที่ล็อกไว้ทันที
  - `Project` / `Media Type` selects บน toolbar ถูก **disable + แสดง lock icon** (ผู้เปิดเปลี่ยนไม่ได้)
  - Post-search chips ยัง **เปิดใช้ได้** (ให้ลูกค้าสลับดูทีละกลุ่มภายในขอบเขตที่ผู้ส่งกำหนด)
  - แสดง banner บาง ๆ ว่า “มุมมองที่แชร์ — ตัวกรองหลักถูกล็อก”

## ไฟล์ที่แก้ (3 ไฟล์)

| ไฟล์ | สิ่งที่เปลี่ยน |
|---|---|
| `src/components/poi-proximity-panel.tsx` | รับ `preProject`/`preMedia`/`assetsFullById`/`onShare`; ส่ง `departments`+`mediaTypes` ไป server; เพิ่ม post-search chips + scope toggle บน CSV + ปุ่มแชร์ลิงก์; ขยาย CSV columns |
| `src/routes/map.tsx` | ขยาย `assetIndexById` ให้เก็บ dept+media; ต่อสาย props ใหม่; `validateSearch` สำหรับ URL params; hydrate state + auto-search เมื่อมี `lock=1`; disable Project/Media selects เมื่อ locked; handler ทำ `Copy Link` |
| — ไม่แตะ server function | `searchPOIsNearAssets` รองรับ `departments`+`mediaTypes` อยู่แล้ว |

## จุดที่ไม่ทำ (เพื่อประหยัดเครดิต)
- ไม่สร้างตาราง DB ใหม่ (snapshot link) — ผู้ใช้เลือก “ล็อกใน URL” ในคำตอบก่อนหน้าแล้ว
- ไม่รื้อ layout POI panel — เพิ่มเฉพาะแถว chips + ปุ่มแชร์
- ไม่แตะ PPTX/PDF export ในรอบนี้ (คำถามเกี่ยว CSV เป็นหลัก) — ยืนยันได้ถ้าต้องการให้ scope toggle มีผลกับ PPTX/PDF ด้วย

---

**ยืนยันแผนนี้ได้เลยไหมครับ?** ถ้า OK จะลุยแก้ 2 ไฟล์ในรอบเดียว. ถ้าอยากให้ PPTX/PDF export มี scope toggle เดียวกันด้วย บอกได้ครับ จะเพิ่มไปพร้อมกัน.
