## เปลี่ยนกรอบ "ความถี่ของการ PM" → Calendar View

ลบกราฟแท่ง/โดนัท/ตารางคู่ PM-Claim ทั้งหมดในกรอบนี้ แทนด้วย Calendar 12 เดือน แสดงวันที่มี PM (สีฟ้า) และ Claim (สีแดง)

### Filter ด้านบน Calendar
- เดือน/ปี เริ่มต้น (เช่น ม.ค. 2025)
- เดือน/ปี สิ้นสุด (เช่น ธ.ค. 2025)
- ค้นหารหัสป้าย, แผนก, Media Type (คงไว้เหมือนเดิม)
- Default: 12 เดือนล่าสุดจนถึงเดือนปัจจุบัน

### Calendar Layout
- แสดง grid 12 เดือนในหน้าเดียว (4 คอลัมน์ × 3 แถว บน desktop, responsive ลงเป็น 2/1 คอลัมน์)
- แต่ละเดือนเป็น mini-calendar (7 คอลัมน์ × 6 แถว) มีหัวเดือน-ปี
- แต่ละวันแสดง 2 dot/badge เล็กๆ:
  - 🔵 ฟ้า = วันนั้นมี PM (จาก updatedDate ของ history ที่ category=PM)
  - 🔴 แดง = วันนั้นมี Claim (จาก updatedDate ของ history ที่ category=Claim หรือไม่ใช่ PM)
- ถ้าวันนั้นมีหลายรายการ แสดงตัวเลขจำนวนข้างๆ dot
- Hover/Click วัน → tooltip/popover แสดงรายการ ticket วันนั้น (รหัสป้าย, ticket no, status)

### Logic
- Source: `pmRows` ที่มีอยู่แล้ว + ดึง claim rows เพิ่ม (จาก `mv_pm_history` type=Claim) ใน `getPmInsightsData` server fn
- กรองตาม filter ด้านบน (assetCode, department, mediaType) และตามช่วงเดือน/ปีที่เลือก
- คำนวณ "PM แล้วกี่วันเสีย": สำหรับแต่ละ asset หา PM date ที่ใกล้ที่สุดก่อน claim → แสดงใน tooltip ของวัน claim
- ใช้สีจาก design tokens (เพิ่ม `--pm-blue`, `--claim-red` ใน `src/styles.css` ถ้ายังไม่มี)

### ไฟล์ที่แก้
- `src/lib/pm-insights.functions.ts` — เพิ่ม claimRows ใน return + helper หา PM→Claim gap
- `src/routes/pm-insights.tsx` — ลบ `PmClaimPairsSection` (กรอบเดิม) สร้าง `PmCalendarView` component ใหม่
- `src/styles.css` — เพิ่ม semantic tokens สำหรับสี PM/Claim
