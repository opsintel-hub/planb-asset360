## เมื่อ Ticket หายจากระบบ ให้ลบ Next Step ทิ้งอัตโนมัติ

**ตอนนี้ (ก่อนแก้):** ตาราง `claim_next_steps` ไม่มีความสัมพันธ์กับ `claim_tickets` เลย เวลา sync-claims ทำงานทุก 15 นาที มันจะลบแถวใน `claim_tickets` ที่ไม่อยู่ใน API response ทิ้ง แต่ Next Step notes จะค้างอยู่เป็น orphan rows ตลอดไป

**ทางแก้:** เชื่อม `claim_next_steps.ticket_code` เป็น Foreign Key ไปที่ `claim_tickets.ref_number` แบบ `ON DELETE CASCADE` — พอ sync ลบ ticket ทิ้ง ระบบจะลบ Next Step ที่ผูกกับ ticket นั้นให้เองอัตโนมัติ

### ขั้นตอน (Migration เดียวจบ)

1. ล้าง orphan rows ที่อาจมีอยู่แล้ว: `DELETE FROM claim_next_steps WHERE ticket_code NOT IN (SELECT ref_number FROM claim_tickets)`
2. เพิ่ม unique constraint บน `claim_tickets.ref_number` (ถ้ายังไม่มี — ต้องมีก่อนจึงจะสร้าง FK ได้)
3. เพิ่ม FK: `ALTER TABLE claim_next_steps ADD CONSTRAINT claim_next_steps_ticket_fk FOREIGN KEY (ticket_code) REFERENCES claim_tickets(ref_number) ON DELETE CASCADE`

### ผลลัพธ์

- Ticket ปิดงาน/หายจาก API → Next Step ที่คุยไว้ถูกลบตามทันทีในรอบ sync ถัดไป ไม่มีขยะค้าง
- ยังคงเขียน/แก้/ลบ Next Step ผ่านปุ่มดินสอได้เหมือนเดิม ไม่ต้องแก้โค้ด UI หรือ server function
- ถ้า Ticket กลับมาใหม่ (เคสหายากที่ ref_number เดิมโผล่ซ้ำ) จะเริ่มเขียน Next Step ใหม่หมด — ประวัติเก่าจะไม่กลับมา ซึ่งตรงกับความต้องการ "ไม่ใช้แล้วลบทิ้ง"

**ไฟล์ที่กระทบ:** Migration อย่างเดียว ไม่แตะโค้ด