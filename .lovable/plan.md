## เป้าหมาย
- ปรับโครงสร้างตาราง `mssql_asset_history` ให้ตรงกับ schema ต้นทาง MSSQL (`planb.dbo.AssetHistory`) แบบ 1:1
- เปลี่ยนทุกจุดในระบบที่อ่าน/เขียน `asset_history` ให้มาใช้ `mssql_asset_history` ใหม่
- ลบตาราง `asset_history` และโค้ดที่เกี่ยวข้อง (Plan B Airtable sync เดิม) ทิ้งทั้งหมด

## ขั้นที่ 1 — Restructure `mssql_asset_history` ให้ตรงต้นทาง

ตาราง MSSQL ต้นทางมี 19 คอลัมน์ตามภาพ migration ใหม่จะลบคอลัมน์ `payload` (jsonb) แล้วแตกออกเป็นคอลัมน์จริง โครงใหม่:

```text
id                    uuid PK
project               text
old_code              text       -- mssql: OldCode
media_type            text
bkk_upc               text
category              text       -- 'Monitoring' | 'Claim' | ...
created_date          timestamptz
updated_date          timestamptz
status                text       -- 'Approved' | ...
inform_position       text
inform_detail         text
problem_category      text
problem_equipment     text
problem_detail        text
solution_category     text
solution_detail       text
response_time         numeric
resolve_time          numeric
total_turnaround_time numeric
asset_status          text       -- 'Pass' | 'Fail'
synced_at             timestamptz
```

- คง unique key ธรรมชาติ: `(old_code, created_date, status, category)`
- Index: `old_code`, `created_date`, `category`, `(category, created_date)`
- GRANT + RLS เหมือนเดิม (SELECT ให้ `authenticated`, ALL ให้ `service_role`)
- Backfill จาก `payload` ปัจจุบันลง field ใหม่ในตัว migration เดียว แล้ว drop `payload`

## ขั้นที่ 2 — อัปเดต sync จาก MSSQL

- `supabase/functions/sync-asset-history/index.ts`: map field MSSQL → คอลัมน์ใหม่โดยตรง (ไม่ใส่ `payload` อีก) และ upsert ด้วย natural key ใหม่
- `src/routes/api/public/hooks/sync-asset-history.ts`: ปรับให้สอดคล้องกับ schema ใหม่
- Regen `src/integrations/supabase/types.ts` หลัง migration ผ่าน

## ขั้นที่ 3 — เปลี่ยนทุกการอ่าน `asset_history` → `mssql_asset_history`

ทุก query map field ใหม่ดังนี้:

| logic เดิม (asset_history) | ใหม่ (mssql_asset_history) |
|---|---|
| `type = 'Monitor'` | `category = 'Monitoring'` |
| `type = 'Claim'` | `category = 'Claim'` |
| `type = 'PM'` | `category ILIKE 'PM%'` (ยืนยันด้วยข้อมูลจริงก่อนใช้) |
| `opened_at` | `created_date` |
| `closed_at` | `updated_date` |
| `asset_id` → `assets.id` | join `old_code = assets.code` |
| `ticket_code` | `ref_number` (ถ้ายังมีใช้) |
| `title` / `sla_hours` | ไม่มีต้นทาง → แสดงว่าง |

ไฟล์ที่ต้องแก้:
- `src/lib/data.functions.ts` (จุดอ่าน asset_history ทั้งหมด รวม search history)
- `src/lib/monitoring.functions.ts` (Monitoring tab + filter)
- `src/lib/project-department-map.ts` (ถ้ามี aggregate)
- `src/routes/monitoring.tsx`, `src/routes/pm-insights.tsx`, `src/routes/settings.tsx`, `src/components/breakdown-tab.tsx`

## ขั้นที่ 4 — ลบ Plan B (Airtable) sync และตาราง `asset_history`

- ลบ `src/lib/sync.server.ts` ส่วนที่เขียน `asset_history` (หรือทั้งไฟล์ถ้าไม่ใช้แล้ว) และ UI ปุ่ม Sync Plan B ใน `settings.tsx`
- Migration: `DROP TABLE public.asset_history CASCADE`
- เอา type อ้างอิงออกจากโค้ดทั้งหมด

## ขั้นที่ 5 — ตรวจสอบ

- ค้นหา MTP A12 ใน Monitoring vs Search History → ตัวเลข PM/Monitor/Claim ต้องตรงกัน (ใช้ source เดียวกันแล้ว)
- ตรวจ build, linter, และเช็คว่าไม่มี reference `asset_history` ค้างใน `rg`

## คำยืนยันก่อนเริ่ม

1. ยืนยันลบ Plan B (Airtable) sync ถาวร — ระบบจะใช้ MSSQL เป็นแหล่งเดียว ✅/❌
2. ฟิลด์ที่ไม่มีใน MSSQL (`title`, `sla_hours`, รายละเอียด claim ticket แบบเดิม) ยอมให้แสดงว่าง ✅/❌
3. การ map `type='PM'` ใน MSSQL — ขอผม query หาค่าจริงของ `category`/`action` ในตารางก่อน เพื่อยืนยัน mapping ที่ถูกต้อง 100% ก่อนเริ่ม refactor ✅/❌
