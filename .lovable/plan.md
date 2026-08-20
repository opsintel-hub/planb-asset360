# เชื่อมต่อ CRM (MySQL `view_productstatus`) + ระบบข้อมูลชื่อโฆษณาทั้งระบบ

## ข้อสำคัญก่อนเริ่ม (ต้องแก้ก่อนถึงจะ Sync จริงได้)

`172.24.100.57:3306` เป็น **IP ภายในองก์กร** — ผมทดสอบแล้ว เชื่อมต่อจากภายนอก (Lovable Cloud) ไม่ได้เลย
เหมือนกรณี MSSQL ที่ทีม IT ต้องเปิด host สาธารณะ (`magicticket.magicsigncloud.com:1433`) ให้

ต้องขออย่างใดอย่างหนึ่งจากทีม IT:
1. Public hostname/IP + เปิดพอร์ต 3306 ให้ allowlist (แนะนำ — เหมือน MSSQL เดิม), หรือ
2. Read-only replica ที่อยู่บน public host, หรือ
3. ถ้าเปิดไม่ได้: ให้ทีม IT push ข้อมูล `view_productstatus` เข้ามาเป็นรายวันผ่าน endpoint ที่เราสร้างให้ (`/api/public/hooks/sync-ad-contracts`) ด้วย token

ผมจะสร้างทั้งโครงสร้าง (ตาราง + UI + ทุกเมนู) ให้เสร็จก่อน โดยรองรับทั้งทาง 1 และทาง 3 พร้อมกัน — เปิดพอร์ตวันไหนกด Sync ได้ทันที

## ส่วนที่ 1 — ฐานข้อมูลใหม่

ตาราง `public.ad_contracts` (1 แถว = 1 สัญญาโฆษณาบนป้าย)
- `id`, `asset_old_code` (คู่กับ `assets.old_code` — ยืนยันแล้วว่าเป็น field ที่จับคู่ได้), `equipment_id`
- `product_name` (ชื่อโฆษณา), `ad_contract` (เลขสัญญา), `status`
- `start_date_contract`, `end_date_contract`, `favor_start_date_contract`, `favor_end_date_contract`
- `payload jsonb`, `synced_at`
- unique key: `(ad_contract, asset_old_code, product_name)` เพื่อ upsert ซ้ำได้
- index บน `asset_old_code`, `product_name` (trigram สำหรับค้นหาชื่อ), `status`, ช่วงวันที่
- RLS: อ่านได้ทุกคนที่ล็อกอิน (sale/crm ก็ต้องเห็น เพราะเป็นข้อมูลขาย) + GRANT ตามมาตรฐาน

Sync แบบ snapshot + **เก็บประวัติ**: แถวที่หลุดจาก view จะไม่ลบทิ้ง แต่ตั้ง `status='archived'` เพื่อตอบคำถาม "ป้ายนี้เคยมีโฆษณาอะไรขึ้นมาบ้าง"

View ช่วยงาน: `ad_current_by_asset` (โฆษณาที่ active ต่อป้าย ณ วันนี้) — ใช้ join เร็วในทุกเมนู

## ส่วนที่ 2 — การเชื่อมต่อ + ตั้งเวลา (เหมือนของเดิม)

- Edge function `sync-ad-contracts` (Deno + MySQL driver) อ่าน `view_productstatus` → upsert เข้า `ad_contracts`
- เก็บ config ที่ `app_settings.crm_db_connection` (host/port/database/username/view), รหัสผ่านเก็บใน Secret `CRM_DB_PASSWORD`
- pg_cron job `crm-sync-ad-contracts-daily` + เพิ่มเข้าไปในตัวตั้งเวลาเดิม (ตั้งชั่วโมง/นาทีได้เหมือน MSSQL)
- UI ใน "ตั้งค่าระบบ" → Tab "การเชื่อมต่อหลัก": การ์ดใหม่ **CRM Server (Ad Contract Database)** — แก้ค่าเชื่อมต่อ, ปุ่มทดสอบดึงข้อมูล, สถานะ Sync ล่าสุด, เปิด/ปิดการ Sync
- Endpoint สำรอง `/api/public/hooks/sync-ad-contracts` (ตรวจ token) สำหรับกรณีที่ IT push เข้ามาแทน

## ส่วนที่ 3 — เมนูใหม่ "Ad Campaigns" (ตอบโจทย์ตัวอย่างที่ยกมา)

หน้าใหม่ `/campaigns` (เพิ่มใน `app-menus.ts` → sidebar + ตารางสิทธิ์อัตโนมัติ):
- ค้นหาชื่อโฆษณา → **รายการป้ายทั้งหมดที่โฆษณานั้นขึ้นอยู่** (รหัสป้าย, media type, ทำเล, วันเริ่ม/สิ้นสุด, favor, นับวันคงเหลือ)
- ปุ่ม **ดูบนแผนที่** → เปิด Asset Map พร้อมกรองเฉพาะป้ายของโฆษณานั้น (หมุดเฉพาะชุดนั้น)
- ปุ่ม **แชร์ให้ลูกค้า** → ลิงก์สาธารณะ (ใช้กลไก share token เดิม) โชว์แผนที่ + รายการป้าย
- ปุ่ม **ส่งเข้า Route Monitoring** → ส่งชุด old_code ไปวางแผนเส้นทางตรวจ
- แท็บ **ประวัติ**: โฆษณา A เคยขึ้นป้ายไหนมาแล้ว (จาก archived rows)
- แท็บ **ตามช่วงเวลา**: เลือกช่วง เช่น ม.ค.–มิ.ย. 2026 → โฆษณาอะไรขึ้นบ้าง ที่ป้ายไหน (+ export CSV/Excel)
- แท็บ **ป้ายว่าง (Available)**: ป้ายที่จับคู่แล้วไม่มีโฆษณา current → เลือกป้ายเพื่อเสนอขาย, ดูข้อมูล POI รอบป้าย (ต่อกับ POI Search เดิม) และ export เป็น PPTX/PDF ด้วยเลย์เอาต์เสนอขายที่มีอยู่แล้ว

## ส่วนที่ 4 — เสริมชื่อโฆษณาเข้าเมนูเดิม (ทุกเมนูสมบูรณ์ขึ้น)

| เมนู | เพิ่มอะไร |
|---|---|
| Asset Map | popup ป้าย: ชื่อโฆษณาปัจจุบัน + วันสิ้นสุดสัญญา; ตัวกรอง "มีโฆษณา / ว่าง / สัญญาใกล้หมด ≤30 วัน"; โหมดสีตามสถานะโฆษณา |
| Asset history (Search) | การ์ด "โฆษณาปัจจุบัน" + ไทม์ไลน์ประวัติโฆษณาของป้ายนั้น |
| Claim Aging | คอลัมน์ชื่อโฆษณา (งานซ่อมป้ายที่มีลูกค้าอยู่ = ด่วนกว่า) |
| Route Monitoring | ป้ายที่มีโฆษณา active ถ่วงน้ำหนักความสำคัญ + ชื่อโฆษณาในรายการจุดตรวจ/ไฟล์ส่งช่าง |
| Risk Score / PM Insights | แสดงชื่อโฆษณาในรายการเสี่ยงสูง เพื่อจัดคิวป้ายที่มีลูกค้าอยู่ก่อน |
| Dashboard | การ์ดสรุป: ป้ายมีโฆษณา / ว่าง / สัญญาหมดใน 30 วัน |
| Export (PPTX/PDF) | เพิ่มบรรทัดชื่อโฆษณา + ช่วงสัญญา |

## แบ่งเฟส (ประหยัดเครดิต)

1. **Phase 1** — ตาราง `ad_contracts` + view + RLS + edge function sync + การ์ดตั้งค่า/ตั้งเวลาใน "การเชื่อมต่อหลัก" + endpoint สำรอง
2. **Phase 2** — หน้า `/campaigns` (รายการ, ประวัติ, ช่วงเวลา, ป้ายว่าง) + สิทธิ์
3. **Phase 3** — ผูกเข้า Asset Map (กรอง/หมุด/แชร์ลูกค้า) + ส่งเข้า Route Monitoring
4. **Phase 4** — เสริมชื่อโฆษณาในเมนูที่เหลือ (Search, Claim, Risk, PM, Dashboard, Export)

## หมายเหตุเทคนิค

- Cloudflare Worker ต่อ TCP ตรงไม่ได้ → ใช้ Supabase Edge Function (Deno) เหมือน `sync-assets`
- รหัสผ่าน CRM เก็บเป็น Secret `CRM_DB_PASSWORD` ไม่ฝังในโค้ด
- `favor_*` = วันติดตั้งจริง, `*_contract` = วันตามสัญญา → เก็บทั้งคู่ และใช้ favor เป็นหลักในการตัดสิน "ขึ้นจริงหรือยัง"
