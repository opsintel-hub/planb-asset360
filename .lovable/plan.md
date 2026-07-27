# แผนการแก้ไข

## 1) ตัวกรอง Media Type ผูกกับ Project

- ในหน้า `/map` toolbar (`src/routes/map.tsx`) คำนวณ `mediaTypesForProject` จาก assets จริง: เมื่อ `fProject !== "all"` ให้เลือกเฉพาะ `media_type` ที่ปรากฏใน asset ซึ่ง department ของมัน map ไป Project นั้น (ใช้ `PROJECT_TO_DEPARTMENTS`)
- ส่งลิสต์ที่กรองแล้วให้ `<CompactSelect placeholder="Media Type">`
- เมื่อผู้ใช้เปลี่ยน Project และ `fMedia` เดิมไม่อยู่ในลิสต์ใหม่ → รีเซ็ต `fMedia` เป็น `"all"` (ผ่าน `useEffect`)

## 2) แชร์ลิงก์ POI แบบสาธารณะ อายุ 72 ชั่วโมง

### กระแสงาน

```text
[ผู้ใช้ที่ล็อกอิน] ── กดแชร์ ──▶ createPoiShare()  ── insert row (expires_at = now+72h)
                                       │
                                       └─▶ URL: /shared/poi/<token>
                                       
[คู่ค้า/ลูกค้า] เปิด URL ──▶ /shared/poi/<token>
   │ 1) โหลด API สาธารณะ  GET /api/public/poi-share/<token>
   │      • ถ้า expires_at ≤ now → ลบ row + คืน 410 Gone
   │      • ถ้าไม่พบ → 404
   │      • ถ้าใช้ได้ → คืน payload + expires_at
   │ 2) แสดง Popup แจ้งเตือน (บังคับกด "ยอมรับ" ก่อนดูข้อมูล)
   │      • บอกวัน-เวลา หมดอายุ + เวลาถอยหลัง
   │      • คำเตือนว่าเป็นข้อมูลลับ
   │ 3) เรนเดอร์ Map แบบ read-only + ป้าย POI + รายการผลลัพธ์
```

### Schema (Lovable Cloud migration)

```sql
CREATE TABLE public.poi_shares (
  token text PRIMARY KEY,
  payload jsonb NOT NULL,      -- POIs, matches, assets ที่แสดง, bbox, radius, filters
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
GRANT SELECT ON public.poi_shares TO anon;         -- ผู้รับลิงก์อ่านผ่าน service role ก็ได้ แต่ SELECT ให้ anon ก็พอเพราะ token เดารายไม่ได้
GRANT INSERT, SELECT, DELETE ON public.poi_shares TO authenticated;
GRANT ALL ON public.poi_shares TO service_role;
ALTER TABLE public.poi_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read unexpired shares by token"
  ON public.poi_shares FOR SELECT TO anon
  USING (expires_at > now());

CREATE POLICY "auth can create own shares"
  ON public.poi_shares FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth can read unexpired"
  ON public.poi_shares FOR SELECT TO authenticated USING (expires_at > now());
```

### Payload ที่ฝังไปกับ share (self-contained → ไม่ต้อง auth เพื่อดึงเพิ่ม)

- `pois`, `matches`, `radiusM`, `matchMode`
- `assets` (เฉพาะที่ปรากฏใน matches — ประหยัดพื้นที่): `{id, old_code, name, department, media_type, location, lat, lng}`
- `bbox`, `chipProjects`, `chipMedia`, `project`, `media`

### ไฟล์ที่จะสร้าง/แก้

| ไฟล์ | หน้าที่ |
|---|---|
| `supabase/migrations/*.sql` | สร้างตาราง `poi_shares` + policies |
| `src/lib/poi-share.functions.ts` (ใหม่) | `createPoiShare` (auth) — สร้าง token, บันทึก payload, TTL 72h |
| `src/routes/api/public/poi-share/$token.ts` (ใหม่) | GET public endpoint → คืน payload + expires_at, ลบถ้าหมดอายุ |
| `src/routes/shared/poi.$token.tsx` (ใหม่) | หน้าสาธารณะ: fetch endpoint, Popup ยืนยัน + countdown, แสดง Map + POI list (read-only, ไม่มี toolbar/ทำงานย่อย) |
| `src/routes/map.tsx` | (ก) เพิ่ม cascade Media Type. (ข) `onShare` เรียก `createPoiShare` แทนการ encode ลง URL, คัดลอกลิงก์ใหม่ |
| `src/components/poi-proximity-panel.tsx` | ไม่ต้องแก้ (ยังส่ง state เดิมมาให้) |

### ลบข้อมูลอัตโนมัติ (ประหยัด storage)

- `GET /api/public/poi-share/$token` handler: ถ้า `expires_at <= now()` ให้ `DELETE` แถวนั้นและคืน `410 Gone` — ลบทีละแถวตอนถูกเรียกอีกครั้ง
- เสริม lazy sweep: `DELETE FROM poi_shares WHERE expires_at < now()` รันในทุก `createPoiShare` (มี index อยู่แล้วผ่าน PK; ราคาเล็กมาก) เพื่อล้าง row ที่ไม่มีใครแตะ

### Popup ยืนยัน (หน้า `/shared/poi/:token`)

- Dialog บังคับ modal, ไม่มีปุ่ม close
- แสดง:
  - "ลิงก์นี้เป็นข้อมูลลับของบริษัท"
  - "ลิงก์จะหมดอายุ: 27 ก.ค. 2569 14:32 น. (เหลืออีก 71 ชม. 59 นาที)" — อัปเดตทุกนาที
  - ปุ่ม "ยอมรับและดูข้อมูล"
- หลังกดยอมรับจึง render Map ด้านล่าง
- แถบบนสุดของหน้าโชว์ countdown ตลอดเวลา

### เหตุผลของการเลือก approach นี้

1. Payload บันทึกลง DB → ผู้รับลิงก์ **ไม่ต้องล็อกอิน**, ไม่ต้อง auth ใดๆ
2. Token เป็น URL-safe random 24 ไบต์ → เดาไม่ได้
3. `expires_at` เก็บไว้ตายตัวใน DB — server เป็นแหล่งความจริงเดียว, ปิดจ๊อบเวลาที่ client
4. ลบตอน request หมดอายุ + sweep ตอนสร้างใหม่ → ไม่ต้องมี cron แยก, ประหยัด
5. หน้า public แยกจาก `/map` โดยสมบูรณ์ → ไม่ต้องแก้ auth guard, ไม่มีความเสี่ยงเปิดพื้นที่อื่นให้ anonymous

ยืนยันไหมครับ ถ้ายืนยันจะลงมือทำต่อ
