
## ปัญหา
Street View editor ปัจจุบันอยู่ในกล่อง Analytics (max-w-3xl) และสูงคงที่ `h-[320px]` — พื้นที่แคบมาก ทำให้ลาก 4 มุม distort ไม่แม่น วางป้ายไม่ตรง

## แนวทางแก้

### 1) เพิ่มความสูงเริ่มต้นให้ responsive
- เปลี่ยน `h-[320px]` → `h-[clamp(360px,55vh,640px)]` ใน `src/components/street-view-panel.tsx`
- ได้พื้นที่ทำงานเกือบ 2 เท่าโดยไม่ต้องเปิดโหมดพิเศษ

### 2) เพิ่มปุ่ม "ขยายเต็มจอเพื่อแก้ไข" (Fullscreen Mockup Editor) — ตัวหลักที่ตอบโจทย์
เพิ่มปุ่ม `Maximize` มุมขวาบนของกล่อง Street View ใน `billboard-analytics-panel.tsx` เปิด overlay เต็มจอ:

```
┌──────────────────────────────────────────────┐
│  Header: ชื่อป้าย + [Reset 4 มุม] [เสร็จ ✕]  │
├───────────────────────────────┬──────────────┤
│                               │  แผงควบคุม   │
│                               │  • Opacity   │
│      Street View + Mockup     │  • Rotation  │
│   (h = 100vh − header, ~90%)  │  • Skew X/Y  │
│                               │  • Brightness│
│                               │  • คลิกปรับ4มุม│
│                               │  • เลือก Mockup│
└───────────────────────────────┴──────────────┘
```

รายละเอียด:
- Overlay `fixed inset-0 z-[60] bg-background` (สูงกว่า analytics modal)
- Street View กินพื้นที่ซ้าย ~75% (บนจอ 1080p ได้ ~1400×900)
- แผงควบคุมด้านขวา 320px — reuse controls เดิม (Opacity, Rotation, Skew, Brightness, "คลิกปรับ 4 มุม", "รีเซ็ตมุม", เลือก Mockup, checkbox "แก้ไขได้")
- state `overlay`, `selectedMockup`, `editOverlay`, `cornerPickStep` ยังคงอยู่ที่ `BillboardAnalyticsPanel` — ส่ง prop ลงไปทั้งใน inline panel และ fullscreen editor เพื่อให้ค่าที่แก้ sync กันทันที
- ปิด fullscreen ด้วยปุ่ม X / Esc → ค่ากลับไปแสดงในกล่อง analytics เหมือนเดิม
- Export (PNG hero / PPTX) ยังใช้ `streetViewCaptureRef` ตัวเดิม ไม่กระทบ

### 3) ปรับ handle มุมให้จับง่ายขึ้น
- ขยาย hit area ของจุด 4 มุมจาก `size-3` → `size-4` (invisible padding 6px รอบ) เพื่อคลิกโดนง่ายในทั้ง 2 โหมด
- คงลักษณะภาพจุด (bg-primary/70 ring-white) เท่าเดิม ไม่ให้บังภาพ

## ไฟล์ที่แก้
- `src/components/street-view-panel.tsx` — height responsive, ขยาย hit area handle
- `src/components/billboard-analytics-panel.tsx` — ปุ่ม Maximize + fullscreen overlay (reuse `StreetViewPanel` และ controls เดิม)

ไม่มี logic วิเคราะห์/ backend เปลี่ยน — เป็นงาน UI/UX ล้วน
