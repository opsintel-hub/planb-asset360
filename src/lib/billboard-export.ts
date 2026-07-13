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
const ACCENT = "E11D48";

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
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };

  // Header band
  slide.addShape("rect", { x: 0, y: 0, w: 13.333, h: 0.75, fill: { color: BRAND } });
  slide.addText(`รายงานป้ายโฆษณา · ${input.asset.old_code ?? "—"}`, {
    x: 0.4, y: 0.1, w: 12, h: 0.55, fontSize: 22, bold: true, color: "FFFFFF",
  });

  // Left: hero image
  const hero = await buildHeroImage(input);
  if (hero) {
    slide.addImage({ data: hero, x: 0.4, y: 1.0, w: 7.5, h: 4.2 });
    slide.addText("Street View + Ad Mockup", {
      x: 0.4, y: 5.25, w: 7.5, h: 0.3, fontSize: 10, italic: true, color: "666666",
    });
  } else {
    slide.addShape("rect", {
      x: 0.4, y: 1.0, w: 7.5, h: 4.2, fill: { color: "F1F5F9" }, line: { color: "CBD5E1" },
    });
    slide.addText("(ไม่มี Street View)", {
      x: 0.4, y: 2.8, w: 7.5, h: 0.6, fontSize: 14, color: "94A3B8", align: "center",
    });
  }

  // Right: info panel
  const rightX = 8.2;
  slide.addText("ข้อมูลป้าย", {
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
  slide.addTable(
    rows.map((r) => [
      { text: r[0], options: { bold: true, color: "475569", fontSize: 10 } },
      { text: r[1], options: { color: "0F172A", fontSize: 10 } },
    ]),
    { x: rightX, y: 1.35, w: 4.7, colW: [1.4, 3.3], border: { type: "none", pt: 0, color: "FFFFFF" } },
  );

  if (input.analytics && input.analytics.ok) {
    const a = input.analytics;
    slide.addText("Analytics", {
      x: rightX, y: 3.6, w: 4.7, h: 0.3, fontSize: 12, bold: true, color: BRAND,
    });
    const stats: [string, string][] = [
      ["Traffic Score", `${a.trafficScore}/100 (${a.trafficLabel})`],
      ["POI ในรัศมี", `${a.totalPOIs} แห่ง (${a.radiusM} ม.)`],
      [
        "ประมาณการต่อวัน",
        `${a.estimatedDailyImpressions.min.toLocaleString()}–${a.estimatedDailyImpressions.max.toLocaleString()} ครั้ง`,
      ],
      ["ถนนใกล้สุด", a.nearestRoad ? `${a.nearestRoad.name ?? "-"} (${a.nearestRoad.class}, ${a.nearestRoad.distanceM}ม.)` : "—"],
      ["Peak", a.peakHours.join(", ") || "—"],
    ];
    slide.addTable(
      stats.map((r) => [
        { text: r[0], options: { bold: true, color: "475569", fontSize: 9 } },
        { text: r[1], options: { color: "0F172A", fontSize: 9 } },
      ]),
      { x: rightX, y: 3.9, w: 4.7, colW: [1.5, 3.2], border: { type: "none", pt: 0, color: "FFFFFF" } },
    );

    // Demographics bar
    slide.addText("ประชากรเป้าหมาย", {
      x: rightX, y: 5.6, w: 4.7, h: 0.25, fontSize: 10, bold: true, color: BRAND,
    });
    const demo = a.demographics;
    const total = demo.office + demo.student + demo.shopper + demo.resident + demo.tourist || 1;
    let cx = rightX;
    const segW = 4.7;
    const segs: Array<[keyof typeof demo, string]> = [
      ["office", "3B82F6"],
      ["student", "6366F1"],
      ["shopper", "A855F7"],
      ["resident", "059669"],
      ["tourist", "F59E0B"],
    ];
    for (const [k, color] of segs) {
      const w = (demo[k] / total) * segW;
      if (w > 0.01) {
        slide.addShape("rect", { x: cx, y: 5.9, w, h: 0.28, fill: { color } });
        cx += w;
      }
    }
    slide.addText(
      segs.map(([k, c]) => `■ ${k} ${demo[k]}%`).join("   "),
      { x: rightX, y: 6.25, w: 4.7, h: 0.3, fontSize: 8, color: "475569" },
    );
  }

  // Footer
  slide.addText(
    `สร้างเมื่อ ${new Date().toLocaleString("th-TH")} · Asset History 360`,
    { x: 0.4, y: 7.15, w: 12.5, h: 0.3, fontSize: 9, italic: true, color: "94A3B8" },
  );

  await pres.writeFile({ fileName: `billboard-${input.asset.old_code ?? "report"}.pptx` });
}

export async function exportBillboardPdf(input: ExportInput): Promise<void> {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  // Header
  pdf.setFillColor(23, 54, 93);
  pdf.rect(0, 0, pageW, 40, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(16);
  pdf.text(`Billboard Report · ${input.asset.old_code ?? "-"}`, 24, 26);

  // Hero
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

  // Right column
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
    pdf.text("Analytics", rx, ry);
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

  // Footer
  pdf.setTextColor(160);
  pdf.setFontSize(8);
  pdf.text(
    `Generated ${new Date().toLocaleString("en-US")} · Asset History 360`,
    24,
    pageH - 16,
  );
  pdf.setTextColor(200, 30, 72);
  pdf.text("_", 0, 0); // ref accent so bundler keeps it
  void ACCENT;

  pdf.save(`billboard-${input.asset.old_code ?? "report"}.pdf`);
}

export async function fetchImageAsDataUrl(url: string): Promise<string> {
  return await urlToDataUrl(url);
}
