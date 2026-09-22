import pptxgen from "pptxgenjs";
import JSZip from "jszip";
import type { AssetHistorySummary, AssetRisk } from "@/lib/route-risk.functions";

export type RiskReportAction = {
  title: string;
  detail: string;
  owner: string;
  deadline: string;
  done: string;
};

export type RiskReportMonth = {
  key: string;
  label: string;
  claims: number;
  pm: number;
};

export type RiskReportExportInput = {
  risk: AssetRisk;
  summary: AssetHistorySummary;
  months: RiskReportMonth[];
  actions: RiskReportAction[];
  queueTitle: string;
};

const FONT = "Tahoma";
const C = {
  navy: "0B4FB3",
  navyDark: "123A6D",
  red: "E62535",
  amber: "F4B323",
  green: "24A86A",
  text: "172033",
  muted: "68758A",
  border: "DCE5EF",
  surface: "F5F8FC",
  white: "FFFFFF",
};

function thDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });
}

function eventText(event: AssetHistorySummary["events"][number]): string {
  if (event.type === "PM") return event.solutionDetail || event.problemCategory || "บำรุงรักษาเชิงป้องกัน";
  return event.problemEquipment || event.problemCategory || "รับแจ้งปัญหา";
}

function scoreParts(risk: AssetRisk) {
  return [
    { label: "เคลมค้างเปิด", value: risk.openClaims > 0 ? 40 : 0, max: 40 },
    { label: "เคลม 30 วัน", value: 25 * (Math.min(risk.claims30d, 2) / 2), max: 25 },
    { label: "เคลม 90 วัน", value: 15 * (Math.min(risk.claims90d, 4) / 4), max: 15 },
    { label: "เคลม 365 วัน", value: 10 * (Math.min(risk.claims365d, 8) / 8), max: 10 },
    { label: "วันตั้งแต่ PM ล่าสุด", value: 10 * (Math.min(risk.daysSincePm ?? 0, 180) / 180), max: 10 },
  ].map((part) => ({ ...part, value: Math.round(part.value * 10) / 10 }));
}

function addTextBox(
  slide: ReturnType<pptxgen["addSlide"]>,
  text: string,
  options: Parameters<typeof slide.addText>[1],
) {
  slide.addText(text, { fontFace: FONT, margin: 0, color: C.text, ...options });
}

async function downloadCompatiblePptx(pres: pptxgen, fileName: string): Promise<void> {
  const output = await pres.write({ outputType: "arraybuffer" });
  const zip = await JSZip.loadAsync(output as ArrayBuffer);
  const presentation = zip.file("ppt/presentation.xml");
  if (presentation) {
    const xml = await presentation.async("string");
    const notesMaster = xml.match(/<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>/)?.[0];
    if (notesMaster) {
      const withoutNotesMaster = xml.replace(notesMaster, "");
      const notesSizeIndex = withoutNotesMaster.indexOf("<p:notesSz");
      const repaired = notesSizeIndex >= 0
        ? `${withoutNotesMaster.slice(0, notesSizeIndex)}${notesMaster}${withoutNotesMaster.slice(notesSizeIndex)}`
        : withoutNotesMaster.replace("</p:presentation>", `${notesMaster}</p:presentation>`);
      zip.file("ppt/presentation.xml", repaired);
    }
  }

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportRiskReportPptx(input: RiskReportExportInput): Promise<void> {
  const { risk, summary, months, actions, queueTitle } = input;
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "Plan B Media Public Company Limited";
  pres.subject = "Asset Risk Executive Report";
  pres.title = `Asset Risk Report · ${risk.code}`;
  pres.company = "Plan B Media Public Company Limited";

  const slide = pres.addSlide();
  slide.background = { color: C.surface };

  // Header
  slide.addShape("rect", { x: 0, y: 0, w: 13.333, h: 0.76, fill: { color: C.white }, line: { color: C.border, width: 0.8 } });
  slide.addShape("roundRect", { x: 0.27, y: 0.17, w: 0.43, h: 0.43, rectRadius: 0.05, fill: { color: C.navy }, line: { color: C.navy } });
  addTextBox(slide, "!", { x: 0.27, y: 0.2, w: 0.43, h: 0.28, align: "center", fontSize: 17, bold: true, color: C.white });
  addTextBox(slide, risk.code, { x: 0.81, y: 0.14, w: 3.05, h: 0.28, fontSize: 20, bold: true, color: C.navy, fit: "shrink" });
  slide.addShape("roundRect", { x: 3.98, y: 0.17, w: 0.72, h: 0.22, rectRadius: 0.04, fill: { color: C.red }, line: { color: C.red } });
  addTextBox(slide, risk.level === "critical" ? "วิกฤต" : risk.level === "high" ? "เสี่ยงสูง" : risk.level === "medium" ? "เฝ้าระวัง" : "เสี่ยงต่ำ", { x: 3.98, y: 0.195, w: 0.72, h: 0.14, fontSize: 8, bold: true, color: C.white, align: "center" });
  addTextBox(slide, "รายงานเพื่อการตัดสินใจและสั่งการซ่อมบำรุง", { x: 0.81, y: 0.45, w: 4.1, h: 0.16, fontSize: 9, color: C.muted });
  addTextBox(slide, "คะแนนความเสี่ยงรวม", { x: 11.45, y: 0.13, w: 1.45, h: 0.14, fontSize: 8, bold: true, color: C.muted, align: "right" });
  addTextBox(slide, `${risk.score}`, { x: 11.55, y: 0.28, w: 1.02, h: 0.35, fontSize: 27, bold: true, color: risk.level === "low" ? C.navy : C.red, align: "right" });
  addTextBox(slide, "/100", { x: 12.59, y: 0.45, w: 0.34, h: 0.14, fontSize: 9, color: C.muted });

  // Top summary
  const cardY = 0.96;
  const cards = [
    { x: 0.2, w: 2.33, accent: C.red, label: "CLAIM · 360 วัน", value: `${summary.claimTotal} ครั้ง`, note: `เฉลี่ย ${summary.claimAveragePerMonth} ครั้ง/เดือน` },
    { x: 2.67, w: 2.33, accent: C.navy, label: "PM · 360 วัน", value: `${summary.pmTotal} ครั้ง`, note: `เฉลี่ย ${summary.pmAveragePerMonth} ครั้ง/เดือน` },
    { x: 5.14, w: 2.36, accent: C.amber, label: "สัญญาณหลัก", value: risk.topProblem ?? "ไม่ระบุหมวด", note: `PM ล่าสุด ${thDate(risk.lastPmAt)}` },
  ];
  cards.forEach((card) => {
    slide.addShape("rect", { x: card.x, y: cardY, w: card.w, h: 0.82, fill: { color: C.white }, line: { color: C.border, width: 0.6 } });
    slide.addShape("rect", { x: card.x, y: cardY, w: 0.05, h: 0.82, fill: { color: card.accent }, line: { color: card.accent } });
    addTextBox(slide, card.label, { x: card.x + 0.16, y: cardY + 0.12, w: card.w - 0.28, h: 0.14, fontSize: 9, bold: true, color: card.accent });
    addTextBox(slide, card.value, { x: card.x + 0.16, y: cardY + 0.31, w: card.w - 0.28, h: 0.25, fontSize: card.x === 5.14 ? 12 : 19, bold: true, color: card.x === 0.2 ? C.red : C.navy, fit: "shrink" });
    addTextBox(slide, card.note, { x: card.x + 0.16, y: cardY + 0.62, w: card.w - 0.28, h: 0.12, fontSize: 8, color: C.muted });
  });

  // Score panel
  slide.addShape("rect", { x: 7.68, y: cardY, w: 5.45, h: 1.86, fill: { color: C.white }, line: { color: C.border, width: 0.6 } });
  addTextBox(slide, "องค์ประกอบคะแนน (ย่อ)", { x: 7.84, y: 1.08, w: 2.5, h: 0.18, fontSize: 10, bold: true });
  scoreParts(risk).forEach((part, index) => {
    const y = 1.38 + index * 0.27;
    addTextBox(slide, part.label, { x: 7.84, y, w: 1.55, h: 0.12, fontSize: 7.5 });
    addTextBox(slide, `${part.value}/${part.max}`, { x: 12.3, y, w: 0.61, h: 0.12, fontSize: 7.5, bold: true, align: "right" });
    slide.addShape("rect", { x: 9.46, y: y + 0.025, w: 2.74, h: 0.07, fill: { color: "E8EEF5" }, line: { color: "E8EEF5" } });
    slide.addShape("rect", { x: 9.46, y: y + 0.025, w: Math.max(0.02, 2.74 * (part.value / part.max)), h: 0.07, fill: { color: risk.level === "low" ? C.navy : C.red }, line: { color: risk.level === "low" ? C.navy : C.red } });
  });

  // Monthly history panel
  slide.addShape("rect", { x: 0.2, y: 1.95, w: 7.3, h: 4.98, fill: { color: C.white }, line: { color: C.border, width: 0.6 } });
  addTextBox(slide, "Claim & PM รายเดือน", { x: 0.35, y: 2.1, w: 2.6, h: 0.2, fontSize: 12, bold: true });
  addTextBox(slide, "Claim", { x: 6.1, y: 2.12, w: 0.5, h: 0.14, fontSize: 8, bold: true, color: C.red, align: "right" });
  addTextBox(slide, "PM", { x: 6.75, y: 2.12, w: 0.35, h: 0.14, fontSize: 8, bold: true, color: C.navy, align: "right" });
  months.forEach((month, index) => {
    const col = index % 6;
    const row = Math.floor(index / 6);
    const x = 0.35 + col * 1.15;
    const y = 2.42 + row * 0.53;
    slide.addShape("rect", { x, y, w: 1.04, h: 0.43, fill: { color: month.claims || month.pm ? "F3F7FC" : C.white }, line: { color: C.border, width: 0.5 } });
    addTextBox(slide, month.label, { x: x + 0.08, y: y + 0.07, w: 0.88, h: 0.11, fontSize: 7.5, bold: true });
    addTextBox(slide, month.claims || month.pm ? `${month.claims ? `C ${month.claims}` : ""}${month.claims && month.pm ? "   " : ""}${month.pm ? `P ${month.pm}` : ""}` : "—", { x: x + 0.08, y: y + 0.24, w: 0.88, h: 0.11, fontSize: 7.5, bold: true, color: month.claims ? C.red : month.pm ? C.navy : C.muted });
  });
  addTextBox(slide, "รายการล่าสุด", { x: 0.35, y: 3.55, w: 1.2, h: 0.16, fontSize: 8, bold: true, color: C.muted });
  summary.events.slice(0, 6).forEach((event, index) => {
    const y = 3.82 + index * 0.43;
    if (index % 2 === 0) slide.addShape("rect", { x: 0.34, y: y - 0.05, w: 6.98, h: 0.35, fill: { color: "F8FAFC" }, line: { color: "F8FAFC" } });
    addTextBox(slide, thDate(event.eventAt), { x: 0.44, y, w: 0.83, h: 0.14, fontSize: 7.5, bold: true });
    addTextBox(slide, event.type, { x: 1.34, y, w: 0.48, h: 0.14, fontSize: 7.5, bold: true, color: event.type === "Claim" ? C.red : C.navy });
    addTextBox(slide, eventText(event), { x: 1.9, y, w: 4.05, h: 0.14, fontSize: 7.5, fit: "shrink" });
    addTextBox(slide, event.status ?? "—", { x: 6.05, y, w: 1.08, h: 0.14, fontSize: 7.5, color: C.muted, align: "right", fit: "shrink" });
  });

  // Action plan
  slide.addShape("rect", { x: 7.68, y: 2.97, w: 5.45, h: 3.96, fill: { color: "FFF8F8" }, line: { color: "F3A5AD", width: 0.8 } });
  addTextBox(slide, "แผนปฏิบัติการเร่งด่วน", { x: 7.88, y: 3.13, w: 2.5, h: 0.2, fontSize: 12, bold: true, color: C.red });
  addTextBox(slide, queueTitle, { x: 7.88, y: 3.39, w: 3.7, h: 0.15, fontSize: 8.5, bold: true });
  slide.addShape("roundRect", { x: 11.86, y: 3.16, w: 0.99, h: 0.26, rectRadius: 0.04, fill: { color: C.red }, line: { color: C.red } });
  addTextBox(slide, "ต้องสั่งการ", { x: 11.86, y: 3.225, w: 0.99, h: 0.11, fontSize: 8, bold: true, color: C.white, align: "center" });
  actions.slice(0, 3).forEach((action, index) => {
    const y = 3.7 + index * 1.02;
    slide.addShape("rect", { x: 7.87, y, w: 5.06, h: 0.9, fill: { color: C.white }, line: { color: C.border, width: 0.5 } });
    slide.addShape("ellipse", { x: 8.0, y: y + 0.12, w: 0.25, h: 0.25, fill: { color: C.red }, line: { color: C.red } });
    addTextBox(slide, `${index + 1}`, { x: 8.0, y: y + 0.18, w: 0.25, h: 0.09, fontSize: 7.5, bold: true, color: C.white, align: "center" });
    addTextBox(slide, action.title, { x: 8.38, y: y + 0.1, w: 4.25, h: 0.17, fontSize: 9.5, bold: true, fit: "shrink" });
    addTextBox(slide, action.detail, { x: 8.38, y: y + 0.31, w: 4.25, h: 0.23, fontSize: 7, color: C.muted, fit: "shrink" });
    addTextBox(slide, `ผู้รับผิดชอบ: ${action.owner}`, { x: 8.38, y: y + 0.6, w: 2.4, h: 0.12, fontSize: 7.2, color: C.navy });
    addTextBox(slide, action.deadline, { x: 10.82, y: y + 0.6, w: 1.82, h: 0.12, fontSize: 7.2, bold: true, color: C.red, align: "right" });
    addTextBox(slide, `เกณฑ์ปิดงาน: ${action.done}`, { x: 8.38, y: y + 0.75, w: 4.25, h: 0.11, fontSize: 6.8, color: C.green, fit: "shrink" });
  });

  // Footer
  slide.addShape("rect", { x: 0, y: 7.19, w: 13.333, h: 0.31, fill: { color: C.navy }, line: { color: C.navy } });
  addTextBox(slide, "คะแนนคำนวณทุกคืน · Claim ค้างอัปเดตจากข้อมูลล่าสุด", { x: 0.25, y: 7.29, w: 5.2, h: 0.1, fontSize: 7, color: C.white });
  addTextBox(slide, `ข้อมูลรายงาน ณ ${thDate(summary.generatedAt)} · Critical ≥80 · ทุกข้อความและองค์ประกอบแก้ไขได้`, { x: 7.35, y: 7.29, w: 5.72, h: 0.1, fontSize: 7, color: C.white, align: "right" });

  await downloadCompatiblePptx(pres, `risk-report-${risk.code}-${new Date().toISOString().slice(0, 10)}.pptx`);
}