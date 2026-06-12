
# Monitoring Dashboard

แดชบอร์ดติดตามสุขภาพป้ายแบบ "ภาพรวม → เจาะรายตัว" โดยใช้ข้อมูลที่มีอยู่แล้วจาก `assets`, `asset_history`, `claim_tickets` ไม่ต้องสร้างตาราง monitoring_status ใหม่ (ตารางว่างอยู่ ปล่อยทิ้งไว้)

Route: `/monitoring` (เมนูเดิมในแถบข้าง — แทนที่ของเก่าทั้งหมด)

## โครงสร้าง 4 Tabs

```text
┌─ Filter Bar (sticky): แผนก · BKK/UPC · Project · Date Range ─────────┐
├─ KPI Cards (4 ใบ) ──────────────────────────────────────────────────┤
├─ [Tab1 ภาพรวม] [Tab2 สถานะตรวจ] [Tab3 ตรวจ→Claim] [Tab4 รายป้าย] ──┤
└─────────────────────────────────────────────────────────────────────┘
```

### KPI Cards (4 ใบบนสุด — ตามผลของ filter ปัจจุบัน)
1. **ป้ายทั้งหมด** จำนวน Old Code ใน scope
2. **ยังไม่ได้ตรวจ PM** (assetStatus = "?" หรือ ไม่มี PM ใน 30 วันล่าสุด) — สีส้ม
3. **ตรวจแล้วเสียภายใน 7 วัน** — สีแดง (ป้ายเฝ้าระวังพิเศษ)
4. **Pending Claim** ตั๋วเปิดแต่ยังไม่ได้แตะ (created_date = updated_date) — สีเหลือง

---

### Tab 1 — ภาพรวมสุขภาพ (Health Overview)
- **Donut: สัดส่วนสถานะตรวจ** → ผ่าน / ไม่ผ่าน / ยังไม่ได้ตรวจ
- **Stacked Bar รายแผนก**: จำนวนป้ายแยกตามสถานะตรวจ
- **Top 10 อาการที่พบบ่อย** (จาก `claim_tickets.payload.problemDetail`) — Horizontal Bar

### Tab 2 — สถานะการตรวจ PM (Inspection Status)
จุดประสงค์: หาป้ายที่ยังไม่ได้ตรวจ + ดูความถี่การตรวจ

- **ตาราง**: Old Code · แผนก · จำนวนครั้งที่ตรวจทั้งหมด · ตรวจครั้งล่าสุด · จำนวนวันนับจากครั้งล่าสุด · ค่าเฉลี่ยช่วงห่างระหว่างตรวจ · สถานะปัจจุบัน (Pass / Fail / ?)
- เรียง: ป้ายที่ยังไม่เคยตรวจ → ป้ายที่ตรวจห่างที่สุด
- Highlight แถวสีส้มถ้า > 60 วันไม่ได้ตรวจ, สีแดงถ้าไม่เคยตรวจ
- **Filter ในแท็บ**: เฉพาะที่ยังไม่ได้ตรวจ / ตรวจห่าง / ทั้งหมด

### Tab 3 — ตรวจเสร็จ → Claim (Post-Inspection Aging)
จุดประสงค์: ตรวจเสร็จแล้วกี่วันถึงเสีย + เสียด้วยอาการอะไร (เพื่อแจ้งทีมรอบหน้าให้ตรวจอาการนี้เป็นพิเศษ)

- **Bar Chart bucket** เหมือน PM Insights: `1-3 / 4-7 / 8-15 / 16-30 / 31-60 / 61-90 / >90 วัน`
- **ตารางเจาะ**: Old Code · แผนก · วันที่ตรวจ · วันที่เปิด Claim · ห่าง (วัน) · `problemCategory` · `problemDetail` · `informDetail`
  - แถว ≤7 วัน → Badge "Critical" สีแดง + Highlight
- **Donut "อาการที่เกิดเร็ว (≤7 วัน)"** — top problemDetail
  → ใช้แจ้งทีมตรวจรอบหน้าได้ทันทีว่าอาการอะไรควรเช็คเป็นพิเศษ

### Tab 4 — รายการป้าย (Asset List — รวมทุกรอบของแต่ละป้าย)
ตารางเต็ม + filter ค้นหา Old Code:
- Old Code · แผนก · Ticket Number · Created Date · Updated Date · Closed Date · สถานะ (Pending / Working / Closed) · สถานะตรวจล่าสุด
- ถ้า `Created Date = Updated Date` → Badge "Pending" สีเหลือง
- ถ้า `Closed Date` = null → ยังไม่ปิด
- ค้นหาด้วย Old Code / Ticket Number
- Export CSV

---

## ตัวกรองหลัก (Filter Bar — sticky)
- แผนก (multi-select)
- BKK / UPC
- Project / Media Type
- Date Range (default: 90 วันล่าสุด)

ทุก Tab share filter เดียวกัน — re-compute ผ่าน `useMemo` จาก dataset ที่ server fn ส่งมา

---

## รายละเอียดเชิงเทคนิค

**ไฟล์ใหม่/แก้:**
- `src/lib/monitoring.functions.ts` — server fn `getMonitoringData(filters)` (admin-import inside handler)
  - ดึง `assets`, `asset_history`, `claim_tickets` → คำนวณ aggregate ฝั่ง server ส่งกลับเป็น JSON แบบ pre-computed (เหมือน pm-insights)
  - คืน: `{ kpis, byDepartment, inspectionStatus[], postInspectionPairs[], assetList[], topSymptoms[] }`
- `src/routes/monitoring.tsx` — เขียนใหม่ทั้งหมด (route เดิมที่เป็น Wifi/Online/Offline ลบทิ้ง)
- `src/components/monitoring/` — `Filters.tsx`, `KpiCards.tsx`, `OverviewTab.tsx`, `InspectionTab.tsx`, `AgingTab.tsx`, `AssetListTab.tsx`
- ปรับ `src/components/app-shell.tsx` — เปลี่ยน icon `Wifi` เป็น `Activity` ให้สื่อมากขึ้น
- ปรับ `src/lib/admin.functions.ts` — ลงทะเบียน `/monitoring` ในรายการสิทธิ์ (ถ้ายังไม่มี)

**Logic การ Map ข้อมูล (server side):**
- "ยังไม่ได้ตรวจ" = ไม่มี `asset_history` type=PM ใน 30 วันล่าสุด OR `assetStatus` ในรายการล่าสุด = "?"
- "ตรวจเสร็จ→Claim" pair: เรียง history ต่อ `asset_old_code`, จับคู่ PM (Pass/Fail) กับ Claim ตัวถัดไป, คำนวณ `daysBetween`
- "Pending Claim": `claim_tickets` ที่ `created_date = updated_date` (ตามคำนิยามที่คุณให้)
- ความถี่ตรวจเฉลี่ย: average diff ของ `opened_at` ของ PM ทุกรอบของป้ายเดียวกัน

**Lib:** ใช้ Recharts (มีอยู่แล้ว), ไม่ต้องลงเพิ่ม

---

## สิ่งที่ผมเสนอเพิ่ม (จากที่บอกว่า "เห็นว่าควรเพิ่มอะไรเสนอได้")

1. **"อาการที่ทำนายได้" (Tab 3 Donut)** — Top อาการที่เกิดภายใน ≤7 วันหลังตรวจ → ตอบโจทย์ "คราวหน้าตรวจอาการนี้เป็นพิเศษ" ตรงๆ
2. **Export CSV ใน Tab 4** — ทีมหน้างานเอาไปติดตามต่อได้
3. **Badge "Pending" บน ticket** — ตามนิยาม `created = updated` ที่คุณให้
4. **ปุ่ม drill-through จาก Tab 3 → เปิดดูประวัติป้ายในเมนู "ค้นหาประวัติป้าย"** (ใช้ Old Code เป็น query)

---

หากแผนนี้โอเค ผมจะเริ่ม build เลย — โครงสร้างจะเหมือน PM Insights (loader + server fn + React Query staleTime 5 นาที + Tabs + Recharts) ให้ feel ใกล้กัน ใช้งานง่ายต่อเนื่องกัน
