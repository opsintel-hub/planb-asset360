# PM Insights Dashboard + Import/Export Mapping

เพิ่มเมนูใหม่ **"PM Insights"** (route `/pm-insights`) เป็นแดชบอร์ดรวม PM + Claim ของป้ายทุกแผนกในหน้าเดียว พร้อมระบบ import/export ไฟล์ mapping ให้ admin แก้ไขได้

## 1. ตาราง `informed_mapping` (Lovable Cloud)

สร้างจาก sheet `Data` ของ Excel (534 แถว):

| field | Excel column | ใช้ทำอะไร |
|---|---|---|
| `informed` | Informed | คีย์อาการ |
| `impact_level` | AD Display Impact | จอดับ/ไม่เห็นโฆษณา · แสดงผลไม่สมบูรณ์ · ไม่มีผลต่อการมองเห็น |
| `informed_group` | Informed Group | กลุ่มอาการ |
| `team` | Team | ทีม/แผนก |
| `informed_detail` | Informed Details | key เต็มสำหรับ match `payload.problemDetail` (UNIQUE) |

- RLS: authenticated select / admin write (insert/update/delete)
- GRANT ครบทั้ง authenticated + service_role
- index บน `informed_detail`, `informed`, `impact_level`

วิธี match กับ Claim:
1. ลอง `payload.problemDetail` = `informed_detail`
2. ไม่เจอ → `payload.problemCategory` = `informed`
3. ไม่เจอ → default `impact_level = "ไม่มีผลต่อการมองเห็น"`

## 2. Import / Export Mapping (ในหน้า Settings)

เพิ่ม section ใหม่ "Informed Mapping" ใน `/settings`:

- **Export** — ปุ่มดาวน์โหลด `informed_mapping.xlsx` (สร้างจาก DB ปัจจุบัน ด้วย `xlsx` lib client-side)
- **Import** — อัปโหลด `.xlsx`/`.csv`:
  - parse header → ตรวจคอลัมน์ครบ (Informed, AD Display Impact, Informed Group, Team, Informed Details)
  - validate `AD Display Impact` ∈ 3 ค่าที่กำหนด (เตือนถ้าผิดและ skip แถวนั้น)
  - แสดง preview (จำนวนแถวใหม่/แก้ไข/skip) ก่อนกด **Confirm**
  - Confirm → server fn `replaceInformedMapping(rows)` ลบทั้งหมดแล้ว insert ใหม่ใน transaction (admin-only middleware)
- หลัง import สำเร็จ → invalidate React Query cache ของ pm-insights → คำนวณใหม่ทันที

ใช้ lib `xlsx` (SheetJS) — ทำงานฝั่ง browser ได้ทั้ง import/export

## 3. หน้า `/pm-insights`

### Global Filters (sticky บนสุด)
แผนก (multi) · BKK/UPC · Project/MediaType · Date range (default 90 วันล่าสุด)
→ ทุกกราฟ/ตาราง re-compute ผ่าน `useMemo` จาก filtered dataset

### KPI Cards (4 ใบ)
จำนวนป้าย · PM เสร็จในช่วง · Claim ที่ยัง Working/Pending · Total Downtime (ชม. จาก `totalTurnaroundTime`)

### รายงาน 1 — PM Effectiveness & Aging
- algorithm: เรียง history ต่อ `asset_old_code`, จับคู่ PM(`assetStatus=Pass`) → Claim ตัวถัดไป, คำนวณ `daysBetween`
- bucket: 1–3 / 4–7 / 8–15 / 16–30 / 31–60 / 61–90 / >90
- **Bar chart** นับจำนวน pair ต่อ bucket
- **Drill-down table**: รหัสป้าย, แผนก, วัน PM, วัน Claim, ห่าง, อาการ — แถว ≤7 วัน ไฮไลท์แดง + badge "Critical"
- **Donut 3** (เฉพาะ pair ≤30 วัน): problemCategory · problemDetail · problemEquipment
- **Donut 2**: solutionCategory · solutionDetail

### รายงาน 2 — Downtime & Business Impact
- Join Claim กับ `informed_mapping` → ติด `impact_level`
- **Stacked Bar**: แกน X = แผนก, Y = ชม. downtime, stack 3 impact levels
- **Horizontal Bar**: top 15 `informed_group` เรียง downtime มาก→น้อย

### รายงาน 3 — PM Score (รายเดือน × แผนก)
```
pointPerPair = min(daysBetween, 90) / 90 * 100   (สูง=ดี)
score = average(pointPerPair) ของเดือนนั้น
ถ้า PM แล้วไม่มี Claim ตามมาภายใน 90 วัน → 100
```
- **Line chart** หลายเส้น (1 เส้น/แผนก) ตามเดือน
- ตาราง: เดือน × แผนก พร้อม #PM, #Claim หลัง PM, score

### รายงาน 4 — PM Frequency per Asset
ตาราง: รหัสป้าย, แผนก, #PM ปีนี้, #PM เดือนนี้, ค่าเฉลี่ยช่วงห่าง PM, #Claim ในแต่ละช่วงรอ PM
มุมมองสลับได้: **Table / Calendar (heatmap) / List**

## 4. การดึงข้อมูล
- `src/lib/pm-insights.functions.ts` — server fn `getPmInsights(filters)` (admin import inside handler)
- ดึง `assets`, `asset_history`, `informed_mapping` ผ่าน `supabaseAdmin` (await import ภายใน handler)
- คำนวณ pair/bucket/score ฝั่ง server → ส่ง aggregated JSON
- React Query `staleTime: 5min`

## 5. UI / Library
- Tailwind + shadcn (Card, Select, Table, Tabs, Badge, Button, Dialog สำหรับ import preview)
- Charts: **Recharts** (มีแล้ว)
- ใหม่: `bun add xlsx` (สำหรับ import/export)

## 6. ไฟล์ที่จะสร้าง/แก้
- migration: `informed_mapping` + GRANT + RLS
- seed: `supabase--insert` ลง mapping 534 แถวจาก Excel ที่อัปโหลด
- `src/lib/pm-insights.functions.ts` (getPmInsights)
- `src/lib/mapping.functions.ts` (listInformedMapping, replaceInformedMapping — admin only)
- `src/routes/pm-insights.tsx`
- `src/components/pm-insights/` (Filters, KpiCards, AgingReport, ImpactReport, ScoreReport, FrequencyReport)
- `src/components/mapping-import-export.tsx` (ใช้ใน settings)
- แก้ `src/components/app-shell.tsx` (+ nav item PM Insights + BarChart3 icon)
- แก้ `src/lib/admin.functions.ts` (เพิ่ม `/pm-insights` ในรายการเมนูสิทธิ์)
- แก้ `src/routes/settings.tsx` (mount Mapping section)

เริ่ม build เลยครับ
