## เป้าหมาย
เปลี่ยนทุกหน้า (Dashboard, Search, Claims, Monitoring, Settings, Permissions) จาก mock data ให้ดึงจาก Postgres ของ Lovable Cloud โดยมี Sync Job ที่ดึงข้อมูลจาก PlanB API จริงเข้ามาเก็บไว้

## 1. Schema (migration)

สร้างตารางใน Lovable Cloud:

- `assets` — ทรัพย์สินป้ายโฆษณา
  `id (uuid pk), old_code (text unique), name, department, area, status, latitude, longitude, installed_at, last_pm_at, last_claim_at, last_monitor_ok_at, payload jsonb, updated_at`
- `asset_history` — log งานทั้งหมด (PM / Claim / Monitor)
  `id, asset_id fk, ticket_code, type ('PM'|'Claim'|'Monitor'|'AssetHealth'), title, status, opened_at, closed_at, sla_hours, payload jsonb`
- `claims` — Claim Aging snapshot
  `id, ticket_code unique, asset_id fk null, title, opened_at, age_hours, sla_status, severity, payload jsonb, synced_at`
- `monitoring_status` — สถานะ online/offline + uptime
  `asset_id fk pk, online bool, last_seen_at, uptime_7d numeric, error_code, message, updated_at`
- `airtable_connections` — 8 ช่อง config (รวม schedule)
  `id smallint pk, name, base_id, table_name, enabled bool, schedule jsonb (เวลา auto-sync), api_key_secret_name, updated_at`
- `sync_logs` — Sync history ทุกแหล่ง
  `id bigserial, source ('asset'|'claim'|'airtable'|'monitor'), status ('success'|'warning'|'error'), message, rows_affected int, started_at, finished_at`
- `app_settings` — key/value (endpoints, schedule รายเดือน)
  `key text pk, value jsonb, updated_at`
- `user_roles` + enum `app_role` ('admin','manager','technician','viewer') ตาม security pattern
- function `has_role(uuid, app_role)`

RLS:
- `assets/asset_history/claims/monitoring_status/sync_logs` — `SELECT` to authenticated; `INSERT/UPDATE/DELETE` ใช้ผ่าน server-fn ด้วย `supabaseAdmin` (RLS deny by default)
- `airtable_connections/app_settings` — `SELECT/UPDATE` เฉพาะ `has_role(uid,'admin')`
- `user_roles` — `SELECT` เจ้าของแถวเอง + admin; `INSERT/UPDATE/DELETE` admin เท่านั้น

## 2. Auth
เพิ่ม `/login` (email+password + Google) เพราะแดชบอร์ดต้อง authenticated; ใช้ `_authenticated` layout route ครอบทุกหน้าเดิม

## 3. Server functions (`src/lib/*.functions.ts`)

อ่าน (ใช้ requireSupabaseAuth):
- `getDashboardOverview` — stat cards + trend + status pie + recent + by-department (aggregate จาก assets/asset_history/claims/monitoring_status)
- `searchAssets({q, type})` — รวม PM/Claim/Monitor/Health tabs ของหน้า Search
- `getAssetDetail(oldCode)` — history + sim inputs (PM frequency, maintenance debt)
- `listClaims({slaFilter})` — claim aging
- `listMonitoring()` — online status + uptime
- `getSyncLogs({limit})`, `getAppSettings`, `listAirtableSlots`

เขียน (admin only):
- `updateAppSettings`, `updateAirtableSlot`, `assignRole`, `revokeRole`

Sync (admin only, ผ่าน `supabaseAdmin`):
- `syncAssetsNow` — เรียก SQL Server endpoint? **ไม่เข้าถึง SQL Server โดยตรงจาก Worker** → เรียกผ่าน HTTP API ที่ผู้ใช้ระบุใน `app_settings.asset_api_url` (ถ้าไม่ตั้งจะ error อ่อนๆ และเขียน `sync_logs`)
- `syncClaimsNow` — fetch `https://magicticket.magicsigncloud.com/planb_api/api/Ticket/RemainingClaimTickets` (header API key ถ้ามีใน secret `PLANB_API_KEY`) → upsert `claims`
- `syncAssetHistory(oldCode)` — fetch `…/Ticket/AssetHistory?oldCode={id}` → upsert `asset_history`
- `syncAirtableSlot(id)` — fetch ผ่าน Airtable connector (LOVABLE_API_KEY + AIRTABLE_API_KEY) — *จะ stub ไว้ถ้ายังไม่ได้ connect*

ทุก sync เขียน `sync_logs` ก่อน/หลัง

## 4. Scheduled jobs (pg_cron + pg_net)
- Claim sync ทุก 15 นาที → `POST /api/public/hooks/sync-claims`
- Asset sync 04:00 ตามวันที่ตั้งใน `app_settings.asset_sync_days` (cron ทุกวัน 04:00 แล้ว job เช็คเอง)
- Route `/api/public/hooks/sync-*` ตรวจ `apikey` header == anon key แล้วเรียก function ภายใน

## 5. หน้า UI (refactor)
ทุกหน้าใช้ `useSuspenseQuery` + `queryOptions` เรียก server functions; ลบ array mock; เพิ่ม empty state + skeleton; ปุ่ม "ทดสอบการ Sync" ใน Settings เรียก `syncAssetsNow`/`syncClaimsNow` จริง พร้อม toast

## 6. Secrets ที่ต้องขอเพิ่มเติม (หลัง migration)
- `PLANB_API_KEY` — ถ้า API ต้อง auth (จะถาม user หลัง schema เสร็จ)
- Airtable connector — ผูกผ่าน connector tool เมื่อผู้ใช้พร้อม

## ขอบเขตที่ไม่รวมในรอบนี้
- การเข้าถึง SQL Server ของ Modern Corporate โดยตรง (Worker เข้าไม่ถึง — ต้องผ่าน HTTP gateway)
- การ Sync Airtable จริง (รอ connect connector)

ยืนยันก่อนเริ่มลงมือนะครับ
