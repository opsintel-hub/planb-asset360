## ขอบเขต

แก้ปัญหา 2 จุดในหน้า **Asset history** (`/search`):

1. กราฟใน Tab **Monitoring / Claim / PM** (และอาจรวม Analytics) ไม่แสดงผล
2. ลบปุ่ม **Generate PM Work Order** ใน Tab **Breakdown** (เลิกใช้แล้ว)

---

## งานที่ 1 — Diagnose & Fix กราฟไม่แสดงผล

### สิ่งที่ต้องตรวจสอบก่อนแก้ (Investigation)

ก่อนแก้ผมต้องยืนยันสาเหตุที่แท้จริงด้วยการไล่ดูตามลำดับนี้ (จะทำหลังจาก approve plan):

1. **เปิดหน้า `/search` จริง** ผ่าน Playwright + ใส่ old_code 1 ตัวที่มีข้อมูลใน DB (จะ query หาตัวที่มี Claim/PM/Monitor มากที่สุด) แล้วสลับแท็บ Monitoring / Claim / PM พร้อมจับ console + network เพื่อดูว่า:
   - `getAssetsComparison` คืน `history.length > 0` หรือไม่
   - มี runtime error / NaN ที่ recharts บ่นหรือไม่
   - กราฟ render เป็นพื้นที่ว่าง (axis มี แต่ไม่มีเส้น) หรือ block หายทั้งก้อน

2. **ตรวจ logic ปัจจุบันที่เกี่ยวข้อง** (ใน `src/routes/search.tsx`):
   - `eventDate(h)` (บรรทัด ~204): Claim ใช้ `opened_at` (= `created_date`), PM/Monitor ใช้ `closed_at` (= `updated_date`) → ถ้า `updated_date` เป็น `null` จะ fallback เป็น `opened_at` — เคสนี้น่าจะปลอดภัย
   - `chartData` (บรรทัด ~1131): สร้าง 12 เดือนของ `chartYear` แล้วนับด้วย `history.filter(h => h.asset_id === a.id && eventDate(h)?.startsWith(\`${chartYear}-${mm}\`))`
   - `defaultYear` (บรรทัด ~1112): หยิบปีล่าสุดจาก `yearsAvailable` — ถ้า history มีแต่ปีเก่า กราฟจะโชว์ปีเก่า ผู้ใช้อาจเข้าใจผิดว่า "ไม่แสดงผล"
   - Date filter ที่ส่งไป backend: ค่า default `from = "2026-01-01"` → ถ้าเลือกป้ายที่มีประวัติเฉพาะปี 2024–2025 จะไม่ได้ row คืนมาเลย (นี่คือ candidate สาเหตุอันดับ 1)

3. **ตรวจ backend** (`src/lib/data.functions.ts` → `getAssetsComparison`):
   - filter `created_date >= from` และ `<= to` ใช้กับคอลัมน์ `nvarchar` "YYYY-MM-DD" — string compare ใช้ได้ ถูกต้อง
   - `tab === "PM"` ใช้ `.like("category", "PM%")` ครอบ "PM (Media)", "PM (Schedule)", "PM (non Media)" — OK
   - `limit(2000)` — ถ้าป้ายมีประวัติ > 2000 จะถูกตัด (จุดที่ต้องระวัง แต่ไม่น่าเกี่ยวกับ "ไม่แสดงผลเลย")

### Hypothesis อันดับสาเหตุ (จากความเป็นไปได้)

| # | สาเหตุที่คาด | วิธีแก้ |
|---|---|---|
| 1 | `from` default = `2026-01-01` กรองทิ้งข้อมูลปีก่อน → history ว่าง → กราฟไม่โผล่ (มี `history.length > 0 && ...`) | เปลี่ยน default `from` เป็น 12 เดือนย้อนหลังจากวันนี้ หรือ "ทั้งหมด" |
| 2 | ป้ายที่เลือกไม่มีข้อมูลในตาราง `mssql_asset_history` (มีแต่ใน `claim_tickets` / `monitoring_status`) | เพิ่ม empty-state แจ้ง "ไม่มีประวัติในช่วงเวลานี้" + ปุ่มขยายช่วงอัตโนมัติ |
| 3 | `chartYear` ค้างที่ปีที่ไม่มีข้อมูล (`defaultYear` คำนวณครั้งเดียวจากข้อมูลที่ load มา) | ปรับ `defaultYear` ให้อัปเดตเมื่อ history เปลี่ยน + แสดงตัวเลือกปีที่มีข้อมูลจริง |
| 4 | สาเหตุอื่น (runtime error / asset_id ไม่ตรง) | แก้ตามผลจาก step Investigation |

ผมจะ **ไม่ลงมือแก้จนกว่าจะยืนยันสาเหตุจริง** เพื่อไม่ให้ "แก้ผิดจุด" เหมือนรอบก่อน

### แผน Fix หลัง Investigation

ขึ้นอยู่กับผล ดังนี้:

- ถ้าเป็น **เคส 1**: เปลี่ยน `useState("2026-01-01")` → `useState(() => { const d = new Date(); d.setMonth(d.getMonth()-12); return d.toISOString().slice(0,10); })` ใน `src/routes/search.tsx`
- ถ้าเป็น **เคส 2**: เพิ่ม empty-state UI ใน `RegularTab` เมื่อ `history.length === 0` พร้อมข้อความบอกเหตุผล
- ถ้าเป็น **เคส 3**: ห่อ `defaultYear` ใน `useMemo` + sync `chartYear` ผ่าน `useEffect` ที่ depend on `yearsAvailable.join(",")`
- ถ้าเป็น **เคส 4**: แก้ตามที่เจอ และรายงานก่อนลงมือ

---

## งานที่ 2 — ลบปุ่ม Generate PM Work Order

ไฟล์: `src/components/breakdown-tab.tsx`

ลบ:
- ปุ่ม `<Button onClick={openPMDialog}>...</Button>` (บรรทัด 534–536)
- `<Dialog open={pmOpen} ...>` ทั้งก้อน (บรรทัด 539–582)
- State + functions ที่ใช้เฉพาะปุ่มนี้: `pmOpen`, `pmDate`, `pmAsset`, `pmNote`, `openPMDialog`, `confirmGeneratePM`, `todayStr`, `pmDateInvalid`, `nextPredicted` (ถ้าไม่ถูกใช้ที่อื่น)
- Imports ที่ไม่ใช้แล้ว: `ClipboardList`, `Dialog*`, `Input`, `Info` (ตรวจก่อนลบจริง)

เหลือเฉพาะปุ่ม `Export Insight Report` ใน Actions row

---

## Verification

1. Build ผ่าน (TS strict)
2. เปิด `/search` → เลือกป้ายที่มีข้อมูล → ทุก Tab (Monitoring / Claim / PM) แสดงกราฟ + ตาราง
3. Tab Breakdown → ไม่มีปุ่ม Generate PM Work Order, เหลือแค่ Export
4. Screenshot ยืนยันทั้ง 2 จุด

---

## หมายเหตุ

ทั้งหมดเป็นงานฝั่ง **frontend/presentation** เท่านั้น ไม่แตะ business logic, ไม่แตะ DB schema, ไม่แตะ edge functions (per งานก่อนหน้าที่ user รอ Dev เพิ่ม RefNumber)