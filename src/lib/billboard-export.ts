// Client-side export of billboard reports as PPTX or PDF.
import pptxgen from "pptxgenjs";
import jsPDF from "jspdf";
import type { BillboardAnalytics } from "@/lib/billboard-analytics.functions";
import type { BillboardMockup, BillboardMockupOverlay } from "@/lib/billboard-mockups.functions";
import type { MapAsset } from "@/lib/map.functions";

export type ExportInput = {
  asset: MapAsset;
  analytics: BillboardAnalytics | null;
  streetViewDataUrl: string | null;
  mockup: BillboardMockup | null;
  mockupDataUrl: string | null;
  overlay: BillboardMockupOverlay | null;
};

const BRAND = "17365D";
const MUTED = "64748B";
const DARK = "0F172A";

const DEMO_LABELS_TH: Record<string, string> = {
  office: "พนักงานออฟฟิศ",
  student: "นักเรียน/นักศึกษา",
  shopper: "นักช้อป",
  resident: "ผู้อยู่อาศัย",
  tourist: "นักท่องเที่ยว",
};
const DEMO_COLORS: Record<string, string> = {
  office: "3B82F6",
  student: "6366F1",
  shopper: "A855F7",
  resident: "059669",
  tourist: "F59E0B",
};

// Compose Street View + mockup overlay into a single JPEG data URL via a canvas.
export async function composeStreetViewWithOverlay(
  streetViewDataUrl: string,
  mockupDataUrl: string,
  overlay: BillboardMockupOverlay,
): Promise<string> {
  const sv = await loadImage(streetViewDataUrl);
  const mk = await loadImage(mockupDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = sv.width;
  canvas.height = sv.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return streetViewDataUrl;
  ctx.drawImage(sv, 0, 0);
  ctx.globalAlpha = overlay.opacity;
  const x = (overlay.x / 100) * sv.width;
  const y = (overlay.y / 100) * sv.height;
  const w = (overlay.w / 100) * sv.width;
  const h = (overlay.h / 100) * sv.height;
  if (overlay.rotation) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((overlay.rotation * Math.PI) / 180);
    ctx.drawImage(mk, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(mk, x, y, w, h);
  }
  return canvas.toDataURL("image/jpeg", 0.92);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function urlToDataUrl(url: string): Promise<string> {
  const r = await fetch(url);
  const blob = await r.blob();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

async function buildHeroImage(input: ExportInput): Promise<string | null> {
  if (!input.streetViewDataUrl) return null;
  if (input.mockupDataUrl && input.overlay) {
    try {
      return await composeStreetViewWithOverlay(
        input.streetViewDataUrl,
        input.mockupDataUrl,
        input.overlay,
      );
    } catch {
      return input.streetViewDataUrl;
    }
  }
  return input.streetViewDataUrl;
}

export async function exportBillboardPptx(input: ExportInput): Promise<void> {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5

  // ============ Slide 1: Overview + Info ============
  const s1 = pres.addSlide();
  s1.background = { color: "FFFFFF" };
  s1.addShape("rect", { x: 0, y: 0, w: 13.333, h: 0.75, fill: { color: BRAND } });
  s1.addText(`รายงานป้ายโฆษณา · ${input.asset.old_code ?? "—"}`, {
    x: 0.4, y: 0.1, w: 12, h: 0.55, fontSize: 22, bold: true, color: "FFFFFF",
  });

  const hero = await buildHeroImage(input);
  if (hero) {
    s1.addImage({ data: hero, x: 0.4, y: 1.0, w: 7.5, h: 4.2 });
    s1.addText("Street View + Ad Mockup", {
      x: 0.4, y: 5.25, w: 7.5, h: 0.3, fontSize: 10, italic: true, color: MUTED,
    });
  } else {
    s1.addShape("rect", {
      x: 0.4, y: 1.0, w: 7.5, h: 4.2, fill: { color: "F1F5F9" }, line: { color: "CBD5E1" },
    });
    s1.addText("(ไม่มี Street View)", {
      x: 0.4, y: 2.8, w: 7.5, h: 0.6, fontSize: 14, color: "94A3B8", align: "center",
    });
  }

  const rightX = 8.2;
  s1.addText("ข้อมูลป้าย", {
    x: rightX, y: 1.0, w: 4.7, h: 0.3, fontSize: 12, bold: true, color: BRAND,
  });
  const rows: [string, string][] = [
    ["รหัส", input.asset.old_code ?? "—"],
    ["ชื่อ", input.asset.name ?? input.asset.location ?? "—"],
    ["Department", input.asset.department ?? "—"],
    ["Media Type", input.asset.media_type ?? "—"],
    ["Location", input.asset.location ?? "—"],
    ["สถานะ", input.asset.status ?? "—"],
    ["พิกัด", `${input.asset.lat.toFixed(5)}, ${input.asset.lng.toFixed(5)}`],
  ];
  s1.addTable(
    rows.map((r) => [
      { text: r[0], options: { bold: true, color: "475569", fontSize: 10 } },
      { text: r[1], options: { color: DARK, fontSize: 10 } },
    ]),
    { x: rightX, y: 1.35, w: 4.7, colW: [1.4, 3.3], border: { type: "none", pt: 0, color: "FFFFFF" } },
  );

  if (input.analytics && input.analytics.ok) {
    const a = input.analytics;
    s1.addText("สรุป Analytics", {
      x: rightX, y: 3.6, w: 4.7, h: 0.3, fontSize: 12, bold: true, color: BRAND,
    });
    // Traffic score big
    s1.addText(`${a.trafficScore}`, {
      x: rightX, y: 3.95, w: 1.2, h: 0.9, fontSize: 44, bold: true, color: BRAND,
    });
    s1.addText(`/ 100 · ${a.trafficLabel}`, {
      x: rightX + 1.2, y: 4.3, w: 3.5, h: 0.4, fontSize: 12, color: DARK,
    });
    s1.addText("Traffic Score", {
      x: rightX + 1.2, y: 4.6, w: 3.5, h: 0.3, fontSize: 9, color: MUTED,
    });
    const stats: [string, string][] = [
      ["POI ในรัศมี", `${a.totalPOIs} แห่ง (${a.radiusM} ม.)`],
      [
        "ประมาณการต่อวัน",
        `${a.estimatedDailyImpressions.min.toLocaleString()}–${a.estimatedDailyImpressions.max.toLocaleString()} ครั้ง`,
      ],
      ["ถนนใกล้สุด", a.nearestRoad ? `${a.nearestRoad.name ?? "-"} (${a.nearestRoad.class}, ${a.nearestRoad.distanceM}ม.)` : "—"],
      ["Peak", a.peakHours.join(", ") || "—"],
    ];
    s1.addTable(
      stats.map((r) => [
        { text: r[0], options: { bold: true, color: "475569", fontSize: 9 } },
        { text: r[1], options: { color: DARK, fontSize: 9 } },
      ]),
      { x: rightX, y: 5.0, w: 4.7, colW: [1.5, 3.2], border: { type: "none", pt: 0, color: "FFFFFF" } },
    );
  }

  s1.addText(
    `สร้างเมื่อ ${new Date().toLocaleString("th-TH")} · Asset History 360`,
    { x: 0.4, y: 7.15, w: 12.5, h: 0.3, fontSize: 9, italic: true, color: "94A3B8" },
  );

  // ============ Slide 2: Analytics Detail ============
  if (input.analytics && input.analytics.ok) {
    const a = input.analytics;
    const s2 = pres.addSlide();
    s2.background = { color: "FFFFFF" };
    s2.addShape("rect", { x: 0, y: 0, w: 13.333, h: 0.75, fill: { color: BRAND } });
    s2.addText(`Analytics · ${input.asset.old_code ?? "—"} · รัศมี ${a.radiusM} ม.`, {
      x: 0.4, y: 0.1, w: 12, h: 0.55, fontSize: 20, bold: true, color: "FFFFFF",
    });

    // Demographics (left)
    s2.addText("ประชากรเป้าหมาย (จำลอง)", {
      x: 0.4, y: 1.0, w: 6.3, h: 0.3, fontSize: 13, bold: true, color: BRAND,
    });
    const demo = a.demographics;
    const total = demo.office + demo.student + demo.shopper + demo.resident + demo.tourist || 1;
    const segs: Array<keyof typeof demo> = ["office", "student", "shopper", "resident", "tourist"];
    let cx = 0.4;
    const barW = 6.3;
    for (const k of segs) {
      const w = (demo[k] / total) * barW;
      if (w > 0.01) {
        s2.addShape("rect", { x: cx, y: 1.4, w, h: 0.32, fill: { color: DEMO_COLORS[k] } });
        cx += w;
      }
    }
    // Legend rows
    let ly = 1.85;
    for (const k of segs) {
      s2.addShape("rect", { x: 0.4, y: ly + 0.06, w: 0.18, h: 0.18, fill: { color: DEMO_COLORS[k] } });
      s2.addText(DEMO_LABELS_TH[k], {
        x: 0.65, y: ly, w: 3.5, h: 0.3, fontSize: 11, color: DARK,
      });
      s2.addText(`${demo[k]}%`, {
        x: 4.2, y: ly, w: 2.5, h: 0.3, fontSize: 11, bold: true, color: DARK, align: "right",
      });
      ly += 0.32;
    }

    // Peak hours chips
    s2.addText("ช่วงเวลาที่คนหนาแน่น", {
      x: 0.4, y: ly + 0.15, w: 6.3, h: 0.3, fontSize: 12, bold: true, color: BRAND,
    });
    let px = 0.4;
    let py = ly + 0.55;
    for (const h of a.peakHours) {
      s2.addShape("roundRect", {
        x: px, y: py, w: 1.4, h: 0.35, fill: { color: "F1F5F9" }, line: { color: "CBD5E1" },
        rectRadius: 0.08,
      });
      s2.addText(h, { x: px, y: py, w: 1.4, h: 0.35, fontSize: 10, align: "center", color: DARK });
      px += 1.5;
    }

    // POI Buckets (right)
    s2.addText("สถานที่ใกล้เคียง", {
      x: 7.0, y: 1.0, w: 5.9, h: 0.3, fontSize: 13, bold: true, color: BRAND,
    });
    const maxCount = Math.max(1, ...a.buckets.map((b) => b.count));
    let by = 1.4;
    for (const b of a.buckets.slice(0, 10)) {
      const pct = b.count / maxCount;
      s2.addText(`${b.icon} ${b.label}`, {
        x: 7.0, y: by, w: 2.4, h: 0.28, fontSize: 10, color: DARK,
      });
      s2.addShape("rect", {
        x: 9.5, y: by + 0.06, w: 3.0 * pct, h: 0.18, fill: { color: b.color.replace("#", "") },
      });
      s2.addText(`${b.count}`, {
        x: 12.55, y: by, w: 0.35, h: 0.28, fontSize: 10, bold: true, color: DARK, align: "right",
      });
      by += 0.32;
    }

    // Top POIs at bottom
    if (a.topPOIs.length > 0) {
      s2.addText("POI ที่ใกล้ที่สุด", {
        x: 0.4, y: 5.3, w: 12.5, h: 0.3, fontSize: 12, bold: true, color: BRAND,
      });
      const topRows = a.topPOIs.slice(0, 10).map((p) => [
        { text: p.name, options: { color: DARK, fontSize: 9 } },
        { text: p.category, options: { color: MUTED, fontSize: 9 } },
        { text: `${p.distanceM} ม.`, options: { color: DARK, fontSize: 9, align: "right" as const } },
      ]);
      s2.addTable(topRows, {
        x: 0.4, y: 5.65, w: 12.5, colW: [7.5, 3.5, 1.5],
        border: { type: "solid", pt: 0.5, color: "E2E8F0" },
      });
    }

    // Notes footer
    if (a.notes.length > 0) {
      s2.addText(`ข้อสังเกต: ${a.notes.join(" · ")}`, {
        x: 0.4, y: 7.15, w: 12.5, h: 0.3, fontSize: 8, italic: true, color: MUTED,
      });
    }
  }

  await pres.writeFile({ fileName: `billboard-${input.asset.old_code ?? "report"}.pptx` });
}

export async function exportBillboardPdf(input: ExportInput): Promise<void> {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const drawHeader = (title: string) => {
    pdf.setFillColor(23, 54, 93);
    pdf.rect(0, 0, pageW, 40, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(16);
    pdf.text(title, 24, 26);
  };

  // ===== Page 1: Overview =====
  drawHeader(`Billboard Report · ${input.asset.old_code ?? "-"}`);

  const hero = await buildHeroImage(input);
  const heroW = pageW * 0.55;
  const heroH = 260;
  if (hero) {
    try {
      pdf.addImage(hero, "JPEG", 24, 60, heroW, heroH);
    } catch {
      // ignore
    }
  } else {
    pdf.setDrawColor(200);
    pdf.rect(24, 60, heroW, heroH);
    pdf.setTextColor(150);
    pdf.setFontSize(12);
    pdf.text("(No Street View)", 24 + heroW / 2 - 40, 60 + heroH / 2);
  }
  pdf.setTextColor(100);
  pdf.setFontSize(9);
  pdf.text("Street View + Ad Mockup", 24, 60 + heroH + 14);

  const rx = 24 + heroW + 24;
  const rw = pageW - rx - 24;
  pdf.setTextColor(23, 54, 93);
  pdf.setFontSize(13);
  pdf.text("Billboard Info", rx, 78);
  pdf.setDrawColor(23, 54, 93);
  pdf.line(rx, 82, rx + rw, 82);

  const rows: [string, string][] = [
    ["Code", input.asset.old_code ?? "-"],
    ["Name", input.asset.name ?? input.asset.location ?? "-"],
    ["Department", input.asset.department ?? "-"],
    ["Media Type", input.asset.media_type ?? "-"],
    ["Location", input.asset.location ?? "-"],
    ["Status", input.asset.status ?? "-"],
    ["Coords", `${input.asset.lat.toFixed(5)}, ${input.asset.lng.toFixed(5)}`],
  ];
  let ry = 100;
  pdf.setFontSize(10);
  for (const [k, v] of rows) {
    pdf.setTextColor(80);
    pdf.text(k + ":", rx, ry);
    pdf.setTextColor(20);
    const lines = pdf.splitTextToSize(v, rw - 80);
    pdf.text(lines, rx + 80, ry);
    ry += 14 * Math.max(1, lines.length);
  }

  if (input.analytics && input.analytics.ok) {
    const a = input.analytics;
    ry += 8;
    pdf.setTextColor(23, 54, 93);
    pdf.setFontSize(13);
    pdf.text("Analytics Summary", rx, ry);
    pdf.line(rx, ry + 4, rx + rw, ry + 4);
    ry += 20;
    pdf.setFontSize(10);
    const stats: [string, string][] = [
      ["Traffic", `${a.trafficScore}/100 (${a.trafficLabel})`],
      ["POIs", `${a.totalPOIs} in ${a.radiusM}m`],
      ["Impr/day", `${a.estimatedDailyImpressions.min.toLocaleString()}-${a.estimatedDailyImpressions.max.toLocaleString()}`],
      [
        "Nearest road",
        a.nearestRoad ? `${a.nearestRoad.name ?? "-"} (${a.nearestRoad.class}, ${a.nearestRoad.distanceM}m)` : "-",
      ],
      ["Peak hours", a.peakHours.join(", ") || "-"],
    ];
    for (const [k, v] of stats) {
      pdf.setTextColor(80);
      pdf.text(k + ":", rx, ry);
      pdf.setTextColor(20);
      const lines = pdf.splitTextToSize(v, rw - 80);
      pdf.text(lines, rx + 80, ry);
      ry += 14 * Math.max(1, lines.length);
    }
  }

  pdf.setTextColor(160);
  pdf.setFontSize(8);
  pdf.text(
    `Generated ${new Date().toLocaleString("en-US")} · Asset History 360`,
    24,
    pageH - 16,
  );

  // ===== Page 2: Analytics Detail =====
  if (input.analytics && input.analytics.ok) {
    const a = input.analytics;
    pdf.addPage();
    drawHeader(`Analytics Detail · ${input.asset.old_code ?? "-"} · ${a.radiusM}m`);

    // Demographics
    pdf.setTextColor(23, 54, 93);
    pdf.setFontSize(13);
    pdf.text("Target Demographics", 24, 78);
    pdf.line(24, 82, 24 + 340, 82);

    const demo = a.demographics;
    const total = demo.office + demo.student + demo.shopper + demo.resident + demo.tourist || 1;
    const segs: Array<[keyof typeof demo, string, [number, number, number]]> = [
      ["office", DEMO_LABELS_TH.office, [59, 130, 246]],
      ["student", DEMO_LABELS_TH.student, [99, 102, 241]],
      ["shopper", DEMO_LABELS_TH.shopper, [168, 85, 247]],
      ["resident", DEMO_LABELS_TH.resident, [5, 150, 105]],
      ["tourist", DEMO_LABELS_TH.tourist, [245, 158, 11]],
    ];
    // Stacked bar
    let bx = 24;
    const bw = 340;
    for (const [k, , [r, g, b]] of segs) {
      const w = (demo[k] / total) * bw;
      if (w > 0.5) {
        pdf.setFillColor(r, g, b);
        pdf.rect(bx, 92, w, 16, "F");
        bx += w;
      }
    }
    // Legend
    let ly = 122;
    pdf.setFontSize(10);
    for (const [k, label, [r, g, b]] of segs) {
      pdf.setFillColor(r, g, b);
      pdf.rect(24, ly - 8, 10, 10, "F");
      pdf.setTextColor(20);
      pdf.text(label, 40, ly);
      pdf.setTextColor(80);
      pdf.text(`${demo[k]}%`, 24 + 340 - 30, ly, { align: "right" });
      ly += 16;
    }

    // Peak hours
    ly += 8;
    pdf.setTextColor(23, 54, 93);
    pdf.setFontSize(12);
    pdf.text("Peak Hours", 24, ly);
    ly += 12;
    let px = 24;
    pdf.setFontSize(10);
    for (const h of a.peakHours) {
      const tw = pdf.getTextWidth(h) + 16;
      pdf.setFillColor(241, 245, 249);
      pdf.setDrawColor(203, 213, 225);
      pdf.roundedRect(px, ly - 10, tw, 16, 3, 3, "FD");
      pdf.setTextColor(20);
      pdf.text(h, px + 8, ly);
      px += tw + 6;
    }

    // POI Buckets (right column)
    const px2 = 24 + 380;
    pdf.setTextColor(23, 54, 93);
    pdf.setFontSize(13);
    pdf.text("Nearby POI Buckets", px2, 78);
    pdf.line(px2, 82, pageW - 24, 82);
    const bucketMax = Math.max(1, ...a.buckets.map((b) => b.count));
    let py2 = 100;
    pdf.setFontSize(9);
    for (const b of a.buckets.slice(0, 12)) {
      pdf.setTextColor(20);
      pdf.text(`${b.icon} ${b.label}`, px2, py2);
      pdf.setTextColor(80);
      pdf.text(`${b.count}`, pageW - 30, py2, { align: "right" });
      const barLen = (b.count / bucketMax) * 140;
      const hex = b.color.replace("#", "");
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const bl = parseInt(hex.slice(4, 6), 16);
      pdf.setFillColor(r, g, bl);
      pdf.rect(px2 + 180, py2 - 8, barLen, 8, "F");
      py2 += 16;
    }

    // Top POIs
    let ty = Math.max(ly + 20, py2 + 10);
    pdf.setTextColor(23, 54, 93);
    pdf.setFontSize(13);
    pdf.text("Top Nearest POIs", 24, ty);
    pdf.line(24, ty + 4, pageW - 24, ty + 4);
    ty += 18;
    pdf.setFontSize(9);
    for (const p of a.topPOIs.slice(0, 12)) {
      if (ty > pageH - 40) break;
      pdf.setTextColor(20);
      const name = pdf.splitTextToSize(p.name, 320)[0] ?? p.name;
      pdf.text(name, 24, ty);
      pdf.setTextColor(80);
      pdf.text(p.category, 360, ty);
      pdf.text(`${p.distanceM} m`, pageW - 30, ty, { align: "right" });
      ty += 13;
    }

    // Notes
    if (a.notes.length > 0 && ty < pageH - 60) {
      ty += 10;
      pdf.setTextColor(23, 54, 93);
      pdf.setFontSize(11);
      pdf.text("Notes", 24, ty);
      ty += 12;
      pdf.setFontSize(9);
      pdf.setTextColor(60);
      for (const n of a.notes) {
        const lines = pdf.splitTextToSize(`• ${n}`, pageW - 48);
        pdf.text(lines, 24, ty);
        ty += 12 * lines.length;
      }
    }

    pdf.setTextColor(160);
    pdf.setFontSize(8);
    pdf.text(
      `Generated ${new Date().toLocaleString("en-US")} · Asset History 360`,
      24,
      pageH - 16,
    );
  }

  pdf.save(`billboard-${input.asset.old_code ?? "report"}.pdf`);
}

export async function fetchImageAsDataUrl(url: string): Promise<string> {
  return await urlToDataUrl(url);
}
