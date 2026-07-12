## ปัญหา

จากภาพ URL ที่ปุ่ม **Maps** สร้างขึ้นถูกต้อง (`google.com/maps/dir/?api=1&...`) แต่เบราว์เซอร์/เครือข่ายของคุณ **บล็อก www.google.com** (`ERR_BLOCKED_BY_RESPONSE`) ปุ่มเลยเปิดแล้วเจอหน้า "is blocked" ตัวโค้ดไม่ได้พัง — เป็น network policy ฝั่งผู้ใช้

## แนวทางแก้

เปลี่ยนปุ่มเดี่ยว **Maps** เป็นเมนู dropdown ให้เลือกบริการแผนที่ปลายทางได้ + ปุ่ม copy URL เพื่อเอาไปเปิดในมือถือ/เครื่องอื่นที่ไม่โดนบล็อก

### รายการปลายทางในเมนู
1. **Google Maps** (เดิม — `google.com/maps/dir/?api=1&...`)
2. **Google Maps (maps.app)** — ใช้โฮสต์ `maps.app.goo.gl` / `www.google.co.th/maps` เป็น fallback เผื่อ policy บล็อกเฉพาะ `www.google.com`
3. **Apple Maps** — `maps.apple.com/?saddr=...&daddr=...&dirflg=d` (ใช้บน iPhone/Mac ได้)
4. **OpenStreetMap** — `openstreetmap.org/directions?...` (ไม่โดน corporate block ส่วนใหญ่)
5. **Waze** — `waze.com/ul?ll=...&navigate=yes` (ไปทีละจุด)
6. **Copy URL** — copy Google Maps URL ลง clipboard เพื่อส่งไปเปิดบนมือถือ

### การเปลี่ยนแปลงโค้ด
- `src/lib/osrm.ts`: เพิ่มฟังก์ชัน `appleMapsDirectionsUrl`, `osmDirectionsUrl`, `wazeNavigateUrl` (คู่กับ `googleMapsDirectionsUrl` เดิม)
- `src/routes/map.tsx`: เปลี่ยนปุ่ม `Maps` เป็น `DropdownMenu` (shadcn) มี 4 บริการ + Copy URL, ใช้ `navigator.clipboard.writeText` + `toast.success`
- ปุ่ม disabled + tooltip เดิมยังคงอยู่ (โหมด Inspection + ต้องมี Origin + ≥1 Stop)

### สิ่งที่จะยังไม่แก้
- ไม่แตะ business logic การคำนวณเส้นทาง (OSRM) เพราะเป็น UI/link เท่านั้น
- ไม่เพิ่ม embed แผนที่ในแอปแทน Google Maps (นอก scope และเปลืองพื้นที่)

## หลังทำเสร็จ
คุณจะกดปุ่ม **Maps ▾** เลือก OpenStreetMap หรือ Copy URL ได้เลย ไม่ต้องพึ่ง google.com บนเครื่องที่โดนบล็อก
