## สาเหตุที่ยืนยันได้

ปัญหาไม่ได้อยู่ที่ PowerPoint อย่างเดียว แต่เกิดจาก “ระบบพิกัดของ Mockup” ผูกกับขนาดกรอบที่ผู้ใช้กำลังเห็นอยู่ตอนแก้ไข

ตอนนี้มี 2 กรอบที่อัตราส่วนไม่เหมือนกัน:

```text
Fullscreen editor  = กรอบ Street View สูง/กว้างตามหน้าจอผู้ใช้
Popup ปกติ         = กรอบ Street View ใช้ความสูง clamp(360px, 55vh, 640px)
Export PPT/PDF      = เอาภาพ Street View อีกขนาดไปวาด overlay ใหม่
```

ผู้ใช้ Mock ตอนขยายเต็มจอ แต่พอหด popup หรือ export ระบบเอาค่า x/y/w/h/corners แบบเปอร์เซ็นต์เดิมไปใช้กับกรอบที่อัตราส่วนต่างกัน จึงเห็นว่าภาพบิด/ยืด/ไม่ตรง ทั้งที่ตำแหน่งเปอร์เซ็นต์ยังเหมือนเดิม

## แผนแก้ให้จบในรอบเดียว

1. **ล็อกอัตราส่วนพื้นที่ Street View ให้คงที่ทุกโหมด**
   - ให้ Street View ใน popup ปกติ, fullscreen editor, และ export ใช้ฐานภาพอัตราส่วนเดียวกัน
   - ใช้กรอบแบบ `16:9` เป็น canonical frame เพื่อให้พิกัด overlay ไม่เปลี่ยนความหมายเมื่อขยาย/ย่อ
   - fullscreen จะ “ใหญ่ขึ้น” แต่ไม่เปลี่ยนอัตราส่วนภาพ จึงแก้ปัญหา mock แล้วหด popup เพี้ยน

2. **ปรับ StreetViewPanel ให้วัดพิกัดจาก frame จริง ไม่ใช่ container ที่เปลี่ยนตาม layout**
   - เพิ่ม inner frame ที่เป็นพื้นที่ Street View จริง
   - pointer drag / click 4 มุม / transform overlay จะอ้างอิง inner frame เดียวกันทั้งหมด
   - ถ้า fullscreen มีพื้นที่เหลือด้านข้าง/บนล่าง จะเป็นพื้นที่ว่าง ไม่เอามาคำนวณ overlay

3. **ตอน export ให้ใช้ frame เดียวกับ UI**
   - ถ่าย Street View จาก canonical frame
   - compose overlay ด้วยพิกัดเดียวกับที่ผู้ใช้เห็นใน UI
   - ไม่บังคับภาพให้ยืดเต็มช่องใน PowerPoint/PDF

4. **เพิ่ม safety ตอนวางภาพลง PowerPoint/PDF**
   - ใช้ fit-preserve-aspect เท่านั้น: ไม่ stretch, ไม่ cover crop
   - ถ้าภาพไม่พอดีกับช่อง จะย่อให้พอดีและจัดกึ่งกลาง ไม่ยืดด้านข้าง

5. **ตัดสิ่งที่ไม่จำเป็นออก**
   - ไม่แก้ layout รายงานทั้งชุดซ้ำ เพราะสาเหตุหลักอยู่ที่ coordinate frame และ export fitting
   - ไม่เปลี่ยนข้อมูล POI/Analytics/PowerPoint slide 2 เพราะไม่เกี่ยวกับอาการนี้

## ไฟล์ที่จะปรับ

- `src/components/street-view-panel.tsx`
  - เพิ่ม canonical aspect-ratio frame
  - ให้ drag/corner pick/overlay transform ใช้ frame เดียวกัน

- `src/components/billboard-analytics-panel.tsx`
  - ปรับ popup/fullscreen ให้ส่งค่า frame เดียวกัน
  - export จะ capture จาก frame ที่เสถียร ไม่ขึ้นกับสถานะขยาย/หด

- `src/lib/billboard-export.ts`
  - ทำ helper สำหรับวาง hero image แบบรักษาสัดส่วน
  - ใช้ helper เดียวกันกับ PPTX และ PDF

## วิธีตรวจหลังแก้

- Mock ภาพใน fullscreen แล้วกด “เสร็จ” กลับ popup ปกติ: มุมต้องยังตรงตำแหน่งเดิม
- Export PowerPoint/PDF: ภาพ Street View ต้องไม่ยืดด้านข้าง และ overlay ต้องตรงกับที่เห็นใน UI
- ทดสอบด้วยกรณีภาพในตัวอย่างที่ส่งมา: ป้ายด้านซ้ายต้องไม่ถูกบิด/ขยายผิดสัดส่วน