## สรุป
ทำได้ครับ และไม่เสียเวลามาก (~5 นาที) เพราะระบบมีการเชื่อมต่อ MSSQL ต้นทาง (`magicticket.magicsigncloud.com` / `planb.AssetHistory`) พร้อม credential อยู่แล้วใน `MODERN_CORP_DB_PASSWORD`

## สิ่งที่จะทำ

1. **สร้าง edge function ชั่วคราว** `supabase/functions/debug-mssql-query/index.ts`
   - เชื่อมต่อ MSSQL ด้วย config เดียวกับ `sync-asset-history`
   - รับ parameter: `oldCode`, `category`, `fromDate`, `toDate`
   - Query ตรงจาก `AssetHistory` table:
     ```sql
     SELECT RefNumber, OldCode, Category, Status, AssetStatus, 
            CreatedDate, UpdatedDate, Project, MediaType, ...
     FROM AssetHistory
     WHERE OldCode = @oldCode
       AND Category = @category
       AND CreatedDate BETWEEN @from AND @to
     ORDER BY CreatedDate DESC
     ```
   - คืนผลเป็น JSON ทั้งหมดให้ดูว่า `RefNumber` ที่ต้นทางเป็นอะไรจริงๆ (ว่าง / null / มีค่าแต่ sync ไม่ได้)

2. **เรียกใช้ function** ด้วย `OldCode='DP911'`, `Category='Monitoring'`, ช่วง `2026-06-01` ถึง `2026-06-21` แล้วเทียบกับข้อมูลใน `mssql_asset_history` ปัจจุบัน

3. **สรุปผล** ให้ดูว่า:
   - ต้นทางมี `RefNumber` หรือไม่ → ถ้ามีแสดงว่า sync ทิ้งค่าไป (bug ใน sync)
   - ต้นทางไม่มี `RefNumber` → ข้อมูลต้นทางผิดพลาดจริง ต้องไปแก้ที่ระบบต้นทาง

4. **ลบ function ทิ้ง** เมื่อตรวจสอบเสร็จ (เพื่อไม่ให้เหลือ endpoint debug ค้าง)

## ค่าใช้จ่ายเวลา
ประมาณ 3–5 นาที (สร้าง function + deploy + ยิงดูผล + ลบ)
