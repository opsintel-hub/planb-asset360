## เพิ่ม ERD Diagram (แผนผังความสัมพันธ์ฐานข้อมูล) ในเมนูตั้งค่าระบบ

### สิ่งที่จะทำ

เพิ่ม **Sub-tab** ใน `ตั้งค่าระบบ > Database Schema` แบ่งเป็น 2 tab ย่อย:
1. **List View** — มุมมองรายการแบบเดิม
2. **ERD Diagram** — มุมมองแผนผังแบบภาพตัวอย่างที่ส่งมา (ใหม่)

### ERD Diagram จะแสดงอะไรบ้าง

- **การ์ดตาราง** แต่ละตารางเป็นกล่องมีหัวสี บอกชื่อตาราง + คอลัมน์ทั้งหมด (มี icon PK/FK) + ชนิดข้อมูล
- **สีหัวการ์ดแยกประเภทอัตโนมัติ:**
  - 🔵 ฟ้า = Source table ปกติ
  - 🟢 เขียว = View / Materialized View (ตรวจจากชื่อขึ้นต้น `mv_` หรือ `kind = 'v'/'m'`)
  - 🟣 ม่วง = Config / Mapping (ชื่อลงท้าย `_mapping`, `_settings`, `_connections`)
  - ⚪ เทา = Auth (`profiles`, `user_roles`)
- **เส้นความสัมพันธ์** ระหว่างตาราง (ดึงจาก Foreign Keys จริงใน `pg_catalog`) พร้อม label `1` / `n`
- **กล่อง "Computed From"** สำหรับ `mv_*` แสดงว่าคำนวณมาจากตารางไหน (เส้นประ) — parse จาก source ของ view/function ที่มีอยู่แล้ว (`refresh_pm_views`) หรือ fallback mapping ในโค้ด
- **Zoom / Pan / Drag** เลื่อนดูได้เพราะตารางเยอะ
- **Legend** อธิบายสีและสัญลักษณ์

### Auto-update เมื่อมีตารางใหม่ (จุดที่ user เน้น)

- ใช้ `getDatabaseSchema` (server fn ที่มีอยู่แล้ว) ซึ่ง query `pg_catalog` แบบสด → **ตารางใหม่ทุกตารางจะขึ้นในแผนผังเองอัตโนมัติ** โดยไม่ต้องแก้โค้ด
- ประเภทสี/กลุ่มจะ detect จาก naming pattern (prefix/suffix) → ตารางใหม่ที่ตั้งชื่อตาม convention จะได้สีถูกกลุ่มเอง
- เส้น FK ก็ดึงจาก `pg_catalog` เช่นกัน → ความสัมพันธ์ใหม่ขึ้นเองเมื่อ migration เพิ่ม FK
- ปุ่ม **Refresh** (มีอยู่แล้ว) + `staleTime: 30s` ให้ query re-fetch เมื่อกลับมาที่หน้านี้
- Layout เป็น **auto-layout algorithm** (จัดกลุ่มตามสี, วางเป็น grid) → ตารางใหม่ถูกวางอัตโนมัติ ไม่ต้อง hardcode ตำแหน่ง
- ถ้าตารางใหม่ยังไม่ถูก map เข้าเมนูใน `TABLE_USAGE` → แสดง badge "ยังไม่ถูกใช้งาน" (มีอยู่แล้ว)

### เทคนิคที่จะใช้

- ใช้ **React Flow** (`@xyflow/react`) — ไลบรารีมาตรฐานสำหรับวาด ERD รองรับ zoom/pan/drag
- Custom node สำหรับกล่องตาราง (คล้าย dbdiagram.io / ภาพตัวอย่าง)
- Auto-layout ด้วย algorithm ง่ายๆ (จัดคอลัมน์ตามกลุ่มสี, เรียงในคอลัมน์ตามจำนวน FK)

### ไฟล์ที่จะแก้

- `bun add @xyflow/react`
- สร้าง `src/components/database-erd-diagram.tsx` — component ERD ใหม่
- แก้ `src/components/database-schema-section.tsx` — ครอบด้วย shadcn Tabs (List / ERD)

### วิธีสั่งงานครั้งหน้า (จำง่ายๆ)

- "เพิ่ม/แก้ ERD diagram" — สำหรับปรับแผนผัง
- "อัปเดต computed-from mapping ของ mv_xxx" — เฉพาะกรณีเพิ่ม MV ใหม่ที่ parser detect ไม่เจอ
- **ตารางใหม่ทั่วไป** — ไม่ต้องสั่งอะไร ระบบดึงจาก database ให้เอง
