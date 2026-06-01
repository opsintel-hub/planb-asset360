import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  context: z.string().min(1).max(20000),
});

export const aiAnalyzeAssets = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const systemPrompt = `คุณเป็นนักวิเคราะห์ข้อมูลการบำรุงรักษาป้ายโฆษณา (Asset Maintenance Analyst).
จงตอบเป็นภาษาไทยกระชับและเป็น actionable. ใช้รูปแบบ Markdown หัวข้อตามนี้เท่านั้น (ห้ามเพิ่มหัวข้ออื่น):

## 🎯 Executive Summary
(2 บรรทัด สรุปสถานการณ์ "ดี/แย่" เปรียบเทียบเดือนล่าสุดกับเดือนก่อน เช่น Claim เพิ่ม/ลด %, Monitor เพิ่ม/ลด)

## 📊 Key Metrics
- MTBF เฉลี่ย: ...
- Predictive Accuracy: ...
- แปลผล: ...

## 🔗 การเชื่อมโยง PM × Claim × Monitor
- การ Monitor ลด Claim จริงไหม (ตั้งรับ vs เชิงรุก)?
- คุณภาพ PM: หลัง PM แล้วเสียในกี่วัน? (<15 วัน = คุณภาพต่ำ)
- สาเหตุที่ Monitor "มองไม่เห็น": ...

## 🚨 ตัวปัญหา (Top Offenders)
ระบุป้าย MTBF < 10 วัน และอาการเสียซ้ำซาก (เช่น "MTP A114 — Reset Media Player 5 ครั้ง/เดือน")

## ✅ สิ่งที่ต้องทำต่อ (Action Items)
1. ...
2. ...
3. ...`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: data.context },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error("AI ถูกจำกัดการเรียก กรุณาลองใหม่ภายหลัง");
      if (res.status === 402) throw new Error("เครดิต AI หมด — กรุณาเติมเครดิตที่ Workspace Settings");
      throw new Error(`AI error ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return { text: json.choices?.[0]?.message?.content ?? "ไม่มีคำตอบ" };
  });
