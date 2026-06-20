
# Root Cause Analysis (RCA)

เมนูใหม่ `/rca` วิเคราะห์อาการเสียของป้ายโฆษณา โดยใช้ข้อมูลจาก `mssql_asset_history` (Claim/PM/Monitoring) ประกบกับ `diagram_mappings` เพื่อจัดกลุ่มอาการเสียอย่างมีโครงสร้าง ใช้ layout เดียวกับ PM Insight (Filter bar + Summary cards + Charts + Table)

## โครงสร้างหน้า

แท็บ (Tabs) 3 แท็บอยู่ใต้ Filter bar ร่วม:

```text
[Filter: Project | Zone | Media Type | Date range | Old Code search]
  ├─ Tab 1: Portfolio Overview      (ภาพรวมทุกป้าย)
  ├─ Tab 2: Per-Asset Deep Dive     (เจาะรายป้าย)
  └─ Tab 3: Diagram Mapping Insight (คุณภาพการ map keywords)
```

### Tab 1 — Portfolio Overview

Summary Cards (4):
- Total Claims (ในช่วงเวลา)
- Unique Assets Affected
- Avg Resolve Time (ชม.)
- Repeat-Failure Rate % (ป้ายที่เสีย ≥3 ครั้ง)

Charts:
- **Pareto Chart** ของ `problem_category` + `problem_equipment` (Bar เรียงมาก→น้อย + เส้น cumulative %) ระบุกลุ่ม 80/20
- **Problem → Solution Matrix** (Heatmap): แกน X = `solution_category`, แกน Y = `problem_category` (จัดกลุ่มจาก diagram_mappings) สีตามจำนวน
- **Top 10 Repeat Offenders** (ตารางป้ายที่เสียซ้ำมากสุด): Old Code, จำนวนเคลม, MTBF, อาการหลัก, คลิกเปิด Tab 2

### Tab 2 — Per-Asset Deep Dive

Input: Autocomplete `Old Code` (reuse จาก PM Insight)

แสดง:
- หัวการ์ดป้าย (Project / Zone / Media Type / Status / Last PM / Last Claim)
- KPI: Total Claims, MTBF (วัน), Avg Resolve Time, Days Since Last Failure
- **Timeline แนวนอน** (เหตุการณ์ทั้งหมด: PM=ฟ้า, Monitoring=เขียว, Claim=แดง) — เหมือน calendar แต่เป็นเส้นเวลาเดียว เพื่อดูว่า PM แล้วกี่วันเสีย, ซ้ำที่ตำแหน่ง/อุปกรณ์เดิมหรือไม่
- **Failure Fingerprint**: Donut ของ problem_category สำหรับป้ายนี้ + อุปกรณ์ที่เสียบ่อย
- **Recurrence Detector**: ถ้า problem_equipment เดิมซ้ำ ≥2 ครั้งภายใน 30 วัน → แสดง alert "อาการซ้ำ — อาจไม่ได้แก้ที่ต้นเหตุ"
- **PM Effectiveness สำหรับป้ายนี้**: แสดงทุกครั้งที่ PM=Pass แล้วเกิด Claim ภายใน N วัน (slider 7/14/30 วัน) — สะท้อนว่า PM ครั้งนั้นมีประสิทธิภาพแค่ไหน
- ตารางประวัติเต็ม (เหมือน tab Breakdown/Claim ของเมนูค้นหา)

### Tab 3 — Diagram Mapping Insight

ใช้ keywords จาก `diagram_mappings` (display/power/structure/system + อื่น ๆ ที่ admin เพิ่ม) มา classify แต่ละแถวของ `mssql_asset_history`:

- Algorithm: รวมข้อความ `problem_category + problem_equipment + problem_detail + inform_detail` แล้วเช็คว่ามี keyword ของ category ไหน (case-insensitive, Thai+English) → ถ้าหลาย match ให้ category ที่ match keyword จำนวนมากกว่า; ถ้าไม่เจอ = `unmapped`
- Pie ของสัดส่วนแต่ละ category + การ์ด `Unmapped %`
- ตาราง **Top Unmapped Phrases** (เคลมที่ไม่เข้า category ใด): จัดกลุ่ม problem_equipment + ความถี่ + ปุ่ม "เสนอเพิ่ม keyword" (link ไปหน้า Settings → Diagram Mappings พร้อม prefill)
- ตาราง coverage ต่อ category (Total claims, MTBF เฉลี่ย, Resolve time เฉลี่ย, Solution ที่ใช้บ่อยสุด) — ช่วยตอบ "หมวด Power ใช้เวลาซ่อมเฉลี่ยนานกว่า Display หรือไม่"

## รายละเอียดทางเทคนิค

### Backend (`src/lib/rca.functions.ts` — สร้างใหม่)

Server functions (ทั้งหมด `requireSupabaseAuth` + เรียกจาก `_authenticated` route):

- `getRcaFilterOptions()` — reuse pattern จาก pm-insights
- `getRcaPortfolio({ filters })` → คืน:
  - summary {totalClaims, uniqueAssets, avgResolveHrs, repeatRatePct}
  - paretoProblem [{label, count, cumulativePct}]
  - paretoEquipment [{label, count, cumulativePct}]
  - matrix [{problemCat, solutionCat, count}]
  - topOffenders [{oldCode, project, zone, claims, mtbfDays, topSymptom}]
- `getRcaAsset({ oldCode })` → คืน asset header, events timeline (PM+Monitoring+Claim), kpi, fingerprint, recurrence flags, pmEffectiveness pairs, history rows
- `getRcaMapping({ filters })` → ดึง diagram_mappings + ทุก claim ในช่วง, classify ใน server, คืน distribution, unmappedPhrases, perCategoryStats

ใช้แหล่งข้อมูล:
- Claim/Monitoring/PM events: `mssql_asset_history` (กรอง category)
- Mapping rules: `diagram_mappings` (enabled=true, เรียง sort_order)
- หัวป้าย: `mssql_asset_history` group by old_code (ล่าสุด)

Classifier เป็น pure function ใน `src/lib/rca-classifier.ts` (shared) เพื่อ unit-testable

### Frontend

- `src/routes/_authenticated/rca.tsx` — สร้างใหม่ พร้อม Tabs (shadcn)
- Components ภายในไฟล์: `<FilterBar/>`, `<PortfolioTab/>`, `<AssetTab/>`, `<MappingTab/>`
- กราฟใช้ recharts (มีอยู่แล้ว): BarChart สำหรับ Pareto (combo bar+line), custom div-grid heatmap, PieChart สำหรับ donut, custom horizontal timeline (div-based)
- สี: ฟ้า PM `--pm-blue`, เขียว Monitoring `--monitor-pass`, แดง Claim `--claim-red` (ใช้ token ที่มีอยู่)
- ปุ่มลิงก์ออก: "ดูใน PM Insights / Search" สำหรับเปิด context อื่น

### Navigation

เพิ่มเมนู "Root Cause" ใน sidebar (ใต้ Monitoring) ด้วยไอคอน `Activity` หรือ `Microscope` จาก lucide-react

### ไม่แก้

- ไม่แตะ `client.ts`, `types.ts`, schemas
- ไม่แก้หน้า PM Insight / Monitoring / Search เดิม
- ไม่สร้าง migration (ข้อมูลครบแล้ว)

## ลำดับงาน

1. สร้าง `rca-classifier.ts` + unit logic
2. สร้าง `rca.functions.ts` (3 server fns)
3. สร้าง route `_authenticated/rca.tsx` + 3 tab components
4. เพิ่มเมนูใน sidebar
5. ทดสอบด้วยข้อมูลจริงผ่าน preview
