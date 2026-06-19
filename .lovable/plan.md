
# ปรับเมนู Monitoring ให้เหมือน PM Insight

ยกโครงสร้างทั้งหมดของ PM Insight มาใช้กับหน้า Monitoring โดยเปลี่ยน source filter จาก category = PM เป็น category = Monitoring

## โครงสร้างหน้าใหม่ (Monitoring)

1. **Filter Bar (ด้านบน)** — เหมือน PM Insight
   - Project, Zone, Department, Media Type, ช่วงวันที่, ค้นหา Old Code/ป้าย

2. **Summary Cards 4 ใบ** (ล้อตาม filter)
   - Total Monitoring (จำนวน ticket Monitoring ทั้งหมด)
   - Asset Status Pass
   - Asset Status Fail
   - Asset Status Skip
   - + การ์ดเสริม: ระยะเวลา Monitoring เฉลี่ย (วัน)

3. **กราฟแท่งรายเดือน** — PM vs Claim → เปลี่ยนเป็น **Monitoring vs Claim**
   - สีเขียว = Monitoring (Pass-style), สีแดง = Claim
   - ใช้ pickDate เดียวกัน (updated_at สำหรับ Monitoring, created_at สำหรับ Claim)

4. **Calendar View 12 เดือน**
   - **เขียว = Pass**, **แดง = Fail** (ตามที่ผู้ใช้เลือก)
   - dot/badge ในแต่ละวัน hover เห็นรายการ asset
   - month/year range picker เหมือน PM Insight

5. **ตารางรายการ Monitoring ทั้งหมด** (show/hide column, แนวนอน scroll)
   - คอลัมน์เหมือน PM Insight: Old Code, Project, Zone, Media Type, Department, Created/Opened/Closed/Updated, Ticket No, Status, Category, Sub-category, อาการ, Asset Status, Last Inspection

## รายละเอียดทางเทคนิค

### `src/lib/monitoring.functions.ts`
- เพิ่ม `getMonitoringInsightsData` (mirror ของ `getPmInsightsData`) ที่ query `mssql_asset_history` เงื่อนไข `category ILIKE '%monitor%'` (แทน PM)
- คืนค่า: filters options, summary (total/pass/fail/skip/avgDays), monthlyChart, calendarDays (เขียว=pass, แดง=fail), tableRows
- คง claimRows สำหรับกราฟ Monitoring vs Claim (อ่านจาก `mv_pm_history` หรือ asset_history category Claim — ยืนยันด้วย logic เดียวกับ PM Insight)

### `src/routes/monitoring.tsx`
- Refactor ทั้งไฟล์ให้ใช้โครงเดียวกับ `pm-insights.tsx`
- Reuse component: `SummaryCard`, `MonthCell`, calendar, table show/hide
- เปลี่ยน label/heading เป็น "Monitoring Insights"
- เก็บฟีเจอร์เดิมของ Monitoring ที่ผู้ใช้ใช้อยู่ (search ป้าย) ให้รวมเข้ากับ filter bar ใหม่

### `src/styles.css`
- เพิ่ม token `--monitor-pass` (เขียว) และ reuse `--claim-red` (แดง) สำหรับ calendar

## หมายเหตุ
- ไม่แตะ schema/migration — ใช้ตารางเดิม (`mssql_asset_history`, `mv_pm_history`)
- โครงทั้งหมด mirror PM Insight 1:1 เพื่อ UX สอดคล้องกัน
