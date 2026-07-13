
## สาเหตุ

ปุ่ม "เปิดใน Google Maps" ปัจจุบันเป็น `<a target="_blank">` ชี้ไปที่ `google.com/maps?...&layer=c` (Street View mode) URL แบบนี้ถูก Google ตอบด้วย header ป้องกัน iframe/redirect ในบางบริบท (โดยเฉพาะเปิดจาก preview iframe หรือเครือข่ายที่บล็อก) → เห็นหน้า `ERR_BLOCKED_BY_RESPONSE` แบบภาพที่ 2

## แนวทางแก้ (ทำเลย ~95% มั่นใจ)

แก้เฉพาะ `src/components/street-view-panel.tsx` — เป็นงาน UI ล้วน ไม่แตะ backend

1. **เปลี่ยน URL รูปแบบใหม่ที่เสถียรกว่า** ใช้ Google Maps deep link ที่ไม่ต้องผ่าน `layer=c` (ซึ่งเป็นตัวกระตุ้นให้บางเบราว์เซอร์/เครือข่ายบล็อก):
   - แทน `https://www.google.com/maps?q=&layer=c&cbll={lat},{lng}` → ใช้
   - `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat},{lng}&heading={heading}` (Street View deep link ทางการ)

2. **เปลี่ยนปุ่มเดียวเป็นกลุ่มปุ่ม 2 อัน** วางที่มุมล่างขวาของ panel และในกล่อง no-imagery:
   - **"เปิด"** — เรียก `window.open(url, "_blank", "noopener,noreferrer")` (แทน `<a>` ล้วน) เพื่อให้แน่ใจว่าเปิดที่ top-level ไม่ใช่ใน iframe
   - **"คัดลอกลิงก์"** — ใช้ `navigator.clipboard.writeText(url)` + toast "คัดลอกลิงก์แล้ว" ผู้ใช้วางเปิดในแท็บ/แอปไหนก็ได้ (Google Maps app บนมือถือก็รับ URL รูปแบบนี้ได้)

3. **Fallback เพิ่ม 1 ตัวเลือก** — ถ้า clipboard API ไม่พร้อม (บาง context) ให้ `prompt(...)` แสดงข้อความให้ก็อปมือ

4. **UI**: จัดปุ่มเป็นกลุ่มพื้นหลัง `bg-background/90 border` แบบเดิม เพิ่มไอคอน `Copy` และ `ExternalLink` (มีอยู่ใน lucide-react แล้ว) — ไม่กระทบธีมหรือ layout อื่น

## ขอบเขต

- แก้เฉพาะ `src/components/street-view-panel.tsx` (2 จุด: ปุ่มมุมล่างขวาเมื่อ `status === "ready"` และปุ่มในกรณี `no-imagery`)
- ไม่แตะไฟล์ export, ไม่แตะ backend, ไม่แตะ overlay logic
