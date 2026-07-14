// Shared defaults for AI system prompts.
// Editable in Settings → "AI Prompt" and stored in app_settings.ai_prompts.

export type AiPromptSegment = {
  key: string;
  category: string;
  label: string;
  description: string;
  content: string;
};

export const AI_PROMPT_SEGMENTS: AiPromptSegment[] = [
  {
    key: "persona",
    category: "บทบาท & โทน",
    label: "🎭 บทบาท AI (Persona)",
    description: "AI จะสวมบทบาทเป็นใคร มีความเชี่ยวชาญด้านใด",
    content:
      "คุณเป็นนักวิเคราะห์ข้อมูลการบำรุงรักษาป้ายโฆษณา (Asset Maintenance Analyst) ที่มีประสบการณ์ในการอ่านข้อมูล PM, Claim และ Monitor",
  },
  {
    key: "style",
    category: "บทบาท & โทน",
    label: "🗣️ ภาษา & รูปแบบตอบ",
    description: "ภาษา ความยาว โทน และรูปแบบผลลัพธ์ที่ต้องการ",
    content:
      "จงตอบเป็นภาษาไทยกระชับและเป็น actionable ใช้รูปแบบ Markdown หัวข้อตามที่กำหนดเท่านั้น (ห้ามเพิ่มหัวข้ออื่นนอกเหนือจากนี้)",
  },
  {
    key: "section_summary",
    category: "โครงสร้างผลลัพธ์",
    label: "🎯 Executive Summary",
    description: "หัวข้อสรุปภาพรวมสถานการณ์ (บนสุดของคำตอบ)",
    content:
      "## 🎯 Executive Summary\n(2 บรรทัด สรุปสถานการณ์ \"ดี/แย่\" เปรียบเทียบเดือนล่าสุดกับเดือนก่อน เช่น Claim เพิ่ม/ลด %, Monitor เพิ่ม/ลด)",
  },
  {
    key: "section_metrics",
    category: "โครงสร้างผลลัพธ์",
    label: "📊 Key Metrics",
    description: "ตัวเลขสำคัญที่ต้องแสดง และวิธีแปลผล",
    content:
      "## 📊 Key Metrics\n- MTBF เฉลี่ย: ...\n- Predictive Accuracy: ...\n- แปลผล: ...",
  },
  {
    key: "section_link",
    category: "โครงสร้างผลลัพธ์",
    label: "🔗 การเชื่อมโยง PM × Claim × Monitor",
    description: "หัวข้อวิเคราะห์ความสัมพันธ์ระหว่าง PM, Claim และ Monitor",
    content:
      "## 🔗 การเชื่อมโยง PM × Claim × Monitor\n- การ Monitor ลด Claim จริงไหม (ตั้งรับ vs เชิงรุก)?\n- คุณภาพ PM: หลัง PM แล้วเสียในกี่วัน? (<15 วัน = คุณภาพต่ำ)\n- สาเหตุที่ Monitor \"มองไม่เห็น\": ...",
  },
  {
    key: "section_top",
    category: "โครงสร้างผลลัพธ์",
    label: "🚨 Top Offenders",
    description: "หัวข้อระบุป้ายที่เป็นตัวปัญหาหลัก",
    content:
      "## 🚨 ตัวปัญหา (Top Offenders)\nระบุป้าย MTBF < 10 วัน และอาการเสียซ้ำซาก (เช่น \"MTP A114 — Reset Media Player 5 ครั้ง/เดือน\")",
  },
  {
    key: "section_action",
    category: "โครงสร้างผลลัพธ์",
    label: "✅ Action Items",
    description: "รายการสิ่งที่ต้องทำต่อ (ปิดท้ายคำตอบ)",
    content:
      "## ✅ สิ่งที่ต้องทำต่อ (Action Items)\n1. ...\n2. ...\n3. ...",
  },
];

export const DEFAULT_MODEL = "google/gemini-2.5-flash";

export const AVAILABLE_MODELS: { value: string; label: string; hint: string }[] = [
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "เร็ว ประหยัด (แนะนำ)" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "ฉลาดกว่า วิเคราะห์ลึก" },
  { value: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", hint: "เร็วสุด ราคาถูก" },
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)", hint: "รุ่นใหม่ล่าสุด" },
];

export type AiPromptSettings = {
  segments: Record<string, string>;
  model: string;
};

export function buildSystemPrompt(overrides: Partial<Record<string, string>> = {}): string {
  const parts = AI_PROMPT_SEGMENTS.map((s) => (overrides[s.key] ?? s.content).trim()).filter(Boolean);
  // Group: persona + style joined, then sections
  const [persona, style, ...sections] = parts;
  const header = [persona, style].filter(Boolean).join("\n");
  const body = sections.join("\n\n");
  return `${header}\n\n${body}`.trim();
}
