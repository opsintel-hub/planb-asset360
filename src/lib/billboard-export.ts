// Client-side export of billboard reports as PPTX or PDF.
import pptxgen from "pptxgenjs";
import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";
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
  /** DOM node containing the on-screen analytics report. Used to snapshot for exports so
   *  Thai text and Overpass POI data render correctly in the exported file. */
  analyticsNode?: HTMLElement | null;
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
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (overlay.rotation) ctx.rotate((overlay.rotation * Math.PI) / 180);
  const skewX = ((overlay.skewX ?? 0) * Math.PI) / 180;
  const skewY = ((overlay.skewY ?? 0) * Math.PI) / 180;
  if (skewX || skewY) ctx.transform(1, Math.tan(skewY), Math.tan(skewX), 1, 0, 0);
  ctx.drawImage(mk, -w / 2, -h / 2, w, h);
  ctx.restore();
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

// Snapshot the analytics DOM into a PNG data URL and dimensions.
// Uses html2canvas-pro (supports modern CSS like oklch used by shadcn tokens).
async function snapshotNode(
  node: HTMLElement,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const canvas = await html2canvas(node, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
    });
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
    };
  } catch (e) {
    console.warn("snapshotNode failed", e);
    return null;
  }
}

// ---------------- Info-slide helpers (Thai text is rendered via image snapshot) ----------------
// We build a hidden HTML block for the "Billboard Info" side so Thai renders correctly
// in both PPTX and PDF exports (avoids jsPDF/pptx default font gaps).
async function renderInfoBlock(input: ExportInput): Promise<{ dataUrl: string; ratio: number } | null> {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-99999px;top:0;width:520px;padding:24px;background:#fff;font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:#0f172a;box-sizing:border-box;";
  const a = input.asset;
  const rows: [string, string][] = [
    ["รหัส", a.old_code ?? "—"],
    ["ชื่อ", a.name ?? a.location ?? "—"],
    ["Department", a.department ?? "—"],
    ["Media Type", a.media_type ?? "—"],
    ["Location", a.location ?? "—"],
    ["สถานะ", a.status ?? "—"],
    ["พิกัด", `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}`],
  ];
  host.innerHTML = `
    <div style="font-size:16px;font-weight:700;color:#17365D;border-bottom:2px solid #17365D;padding-bottom:6px;margin-bottom:10px;">ข้อมูลป้าย</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      ${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:4px 8px 4px 0;color:#475569;font-weight:600;white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:4px 0;color:#0f172a;">${escapeHtml(v)}</td></tr>`,
        )
        .join("")}
    </table>`;
  document.body.appendChild(host);
  try {
    const snap = await snapshotNode(host);
    if (!snap) return null;
    return { dataUrl: snap.dataUrl, ratio: snap.width / snap.height };
  } finally {
    host.remove();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============ PPTX ============
export async function exportBillboardPptx(input: ExportInput): Promise<void> {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
  const BRAND = "17365D";

  // ---- Slide 1: Hero + Info ----
  const s1 = pres.addSlide();
  s1.background = { color: "FFFFFF" };
  s1.addShape("rect", { x: 0, y: 0, w: 13.333, h: 0.75, fill: { color: BRAND } });
  s1.addText(`Billboard Report · ${input.asset.old_code ?? "—"}`, {
    x: 0.4, y: 0.1, w: 12, h: 0.55, fontSize: 22, bold: true, color: "FFFFFF",
    fontFace: "Sarabun",
  });

  const hero = await buildHeroImage(input);
  if (hero) {
    s1.addImage({ data: hero, x: 0.4, y: 1.0, w: 7.5, h: 4.2 });
    s1.addText("Street View + Ad Mockup", {
      x: 0.4, y: 5.25, w: 7.5, h: 0.3, fontSize: 10, italic: true, color: "64748B",
      fontFace: "Sarabun",
    });
  } else {
    s1.addShape("rect", {
      x: 0.4, y: 1.0, w: 7.5, h: 4.2, fill: { color: "F1F5F9" }, line: { color: "CBD5E1" },
    });
    s1.addText("(ไม่มีภาพ Street View)", {
      x: 0.4, y: 2.8, w: 7.5, h: 0.6, fontSize: 14, color: "94A3B8", align: "center",
      fontFace: "Sarabun",
    });
  }

  // Info block as image (Thai renders perfectly)
  const info = await renderInfoBlock(input);
  if (info) {
    const infoW = 4.7;
    const infoH = infoW / info.ratio;
    s1.addImage({ data: info.dataUrl, x: 8.2, y: 1.0, w: infoW, h: Math.min(infoH, 6.0) });
  }

  s1.addText(
    `สร้างเมื่อ ${new Date().toLocaleString("th-TH")} · Asset History 360`,
    { x: 0.4, y: 7.15, w: 12.5, h: 0.3, fontSize: 9, italic: true, color: "94A3B8", fontFace: "Sarabun" },
  );

  // ---- Slide 2: Analytics snapshot (Thai + Overpass data) ----
  if (input.analyticsNode) {
    const snap = await snapshotNode(input.analyticsNode);
    if (snap) {
      const s2 = pres.addSlide();
      s2.background = { color: "FFFFFF" };
      s2.addShape("rect", { x: 0, y: 0, w: 13.333, h: 0.75, fill: { color: BRAND } });
      s2.addText(`Analytics · ${input.asset.old_code ?? "—"}`, {
        x: 0.4, y: 0.1, w: 12, h: 0.55, fontSize: 20, bold: true, color: "FFFFFF",
        fontFace: "Sarabun",
      });
      const availW = 12.5;
      const availH = 6.3;
      const ratio = snap.width / snap.height;
      let w = availW;
      let h = w / ratio;
      if (h > availH) {
        h = availH;
        w = h * ratio;
      }
      s2.addImage({
        data: snap.dataUrl,
        x: (13.333 - w) / 2,
        y: 0.9,
        w,
        h,
      });
    }
  }

  await pres.writeFile({ fileName: `billboard-${input.asset.old_code ?? "report"}.pptx` });
}

// ============ PDF ============
// Uses jsPDF as a shell; every text region that may contain Thai is embedded as an image
// rendered via html2canvas-pro (avoids jsPDF's default helvetica which cannot render Thai).
export async function exportBillboardPdf(input: ExportInput): Promise<void> {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;

  const drawHeader = (title: string) => {
    pdf.setFillColor(23, 54, 93);
    pdf.rect(0, 0, pageW, 40, "F");
    // Header title also as image so Thai renders.
  };

  const drawTextImage = async (
    text: string,
    opts: { x: number; y: number; w: number; fontSize?: number; bold?: boolean; color?: string; italic?: boolean; bg?: string },
  ) => {
    const host = document.createElement("div");
    host.style.cssText = `position:fixed;left:-99999px;top:0;width:${opts.w * 2}px;padding:0;background:${opts.bg ?? "transparent"};font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:${opts.color ?? "#0f172a"};font-size:${(opts.fontSize ?? 12) * 2}px;font-weight:${opts.bold ? 700 : 400};font-style:${opts.italic ? "italic" : "normal"};line-height:1.3;`;
    host.textContent = text;
    document.body.appendChild(host);
    try {
      const c = await html2canvas(host, {
        backgroundColor: opts.bg ?? null,
        scale: 1,
        useCORS: true,
        logging: false,
      });
      const ratio = c.width / c.height;
      const h = opts.w / ratio;
      pdf.addImage(c.toDataURL("image/png"), "PNG", opts.x, opts.y, opts.w, h);
      return h;
    } finally {
      host.remove();
    }
  };

  // ===== Page 1: Overview =====
  drawHeader("");
  await drawTextImage(`รายงานป้ายโฆษณา · ${input.asset.old_code ?? "-"}`, {
    x: margin, y: 8, w: pageW - margin * 2, fontSize: 14, bold: true, color: "#ffffff",
  });

  const hero = await buildHeroImage(input);
  const heroW = pageW * 0.55;
  const heroH = 260;
  if (hero) {
    try {
      pdf.addImage(hero, "JPEG", margin, 60, heroW, heroH);
    } catch {
      // ignore
    }
  } else {
    pdf.setDrawColor(200);
    pdf.rect(margin, 60, heroW, heroH);
    await drawTextImage("(ไม่มีภาพ Street View)", {
      x: margin, y: 60 + heroH / 2 - 10, w: heroW, fontSize: 11, color: "#94A3B8",
    });
  }
  await drawTextImage("Street View + Ad Mockup", {
    x: margin, y: 60 + heroH + 6, w: heroW, fontSize: 9, italic: true, color: "#64748b",
  });

  // Info block as image
  const info = await renderInfoBlock(input);
  if (info) {
    const infoW = pageW - (margin + heroW + margin) - margin;
    const infoH = infoW / info.ratio;
    pdf.addImage(info.dataUrl, "PNG", margin + heroW + margin, 60, infoW, Math.min(infoH, pageH - 100));
  }

  await drawTextImage(
    `สร้างเมื่อ ${new Date().toLocaleString("th-TH")} · Asset History 360`,
    { x: margin, y: pageH - 22, w: pageW - margin * 2, fontSize: 8, italic: true, color: "#94A3B8" },
  );

  // ===== Page 2+: Analytics snapshot (multi-page split) =====
  if (input.analyticsNode) {
    const snap = await snapshotNode(input.analyticsNode);
    if (snap) {
      const contentW = pageW - margin * 2;
      const contentH = pageH - 60; // leave a small header band
      const pxPerPtX = snap.width / contentW;
      const sliceHpx = contentH * pxPerPtX;
      let offset = 0;
      let first = true;
      while (offset < snap.height) {
        pdf.addPage();
        drawHeader("");
        await drawTextImage(`Analytics · ${input.asset.old_code ?? "-"}`, {
          x: margin, y: 8, w: pageW - margin * 2, fontSize: 14, bold: true, color: "#ffffff",
        });
        const remain = snap.height - offset;
        const takePx = Math.min(sliceHpx, remain);
        // Slice via a temporary canvas
        const slice = document.createElement("canvas");
        slice.width = snap.width;
        slice.height = takePx;
        const sctx = slice.getContext("2d");
        if (sctx) {
          const full = await loadImage(snap.dataUrl);
          sctx.drawImage(full, 0, -offset);
        }
        const sliceUrl = slice.toDataURL("image/png");
        const sliceH = (takePx / pxPerPtX);
        pdf.addImage(sliceUrl, "PNG", margin, 50, contentW, sliceH);
        offset += takePx;
        first = false;
        void first;
      }
    }
  }

  pdf.save(`billboard-${input.asset.old_code ?? "report"}.pdf`);
}

export async function fetchImageAsDataUrl(url: string): Promise<string> {
  return await urlToDataUrl(url);
}
