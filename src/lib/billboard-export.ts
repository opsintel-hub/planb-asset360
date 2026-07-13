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

type CornerPoint = { x: number; y: number };

export async function captureStreetViewNode(node: HTMLElement): Promise<string | null> {
  // Prefer capturing Google's Street View WebGL canvas directly — html2canvas
  // cannot read WebGL pixels, but canvas.toDataURL() can when preserveDrawingBuffer
  // is enabled (see google-maps-loader.ts).
  try {
    const canvases = Array.from(node.querySelectorAll("canvas")) as HTMLCanvasElement[];
    let best: HTMLCanvasElement | null = null;
    for (const c of canvases) {
      if (!c.width || !c.height) continue;
      if (!best || c.width * c.height > best.width * best.height) best = c;
    }
    if (best) {
      // Force a fresh render — Street View draws on rAF; wait one frame so we
      // capture the current pose rather than a cleared buffer.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      try {
        const url = best.toDataURL("image/jpeg", 0.92);
        // Guard against blank/transparent buffers (all-black tiny result).
        if (url && url.length > 5000) return url;
      } catch {
        // Fall through to html2canvas below.
      }
    }
  } catch {
    // Fall through.
  }
  try {
    const canvas = await html2canvas(node, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      allowTaint: false,
      logging: false,
      ignoreElements: (el) => {
        const text = el.textContent ?? "";
        const className = (el as HTMLElement).className?.toString?.() ?? "";
        return className.includes("gm-style-cc") || /Keyboard shortcuts|Terms|Report a problem/i.test(text);
      },
    });
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch (e) {
    console.warn("captureStreetViewNode failed", e);
    return null;
  }
}

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
  if (overlay.corners) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sv, 0, 0);
    ctx.globalAlpha = overlay.opacity;
    drawImageInQuad(ctx, mk, [overlay.corners.tl, overlay.corners.tr, overlay.corners.br, overlay.corners.bl].map((p) => ({
      x: (p.x / 100) * sv.width,
      y: (p.y / 100) * sv.height,
    })));
    ctx.globalAlpha = 1;
  }
  return canvas.toDataURL("image/jpeg", 0.92);
}

function interp(a: CornerPoint, b: CornerPoint, t: number): CornerPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function quadPoint(c: CornerPoint[], u: number, v: number): CornerPoint {
  const top = interp(c[0], c[1], u);
  const bottom = interp(c[3], c[2], u);
  return interp(top, bottom, v);
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  src: [CornerPoint, CornerPoint, CornerPoint],
  dst: [CornerPoint, CornerPoint, CornerPoint],
) {
  const [s0, s1, s2] = src;
  const [d0, d1, d2] = dst;
  const denom = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denom) < 1e-6) return;
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denom;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denom;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denom;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denom;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denom;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denom;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function drawImageInQuad(ctx: CanvasRenderingContext2D, img: HTMLImageElement, corners: CornerPoint[]) {
  const steps = 18;
  for (let iy = 0; iy < steps; iy += 1) {
    for (let ix = 0; ix < steps; ix += 1) {
      const u0 = ix / steps;
      const u1 = (ix + 1) / steps;
      const v0 = iy / steps;
      const v1 = (iy + 1) / steps;
      const s00 = { x: u0 * img.width, y: v0 * img.height };
      const s10 = { x: u1 * img.width, y: v0 * img.height };
      const s11 = { x: u1 * img.width, y: v1 * img.height };
      const s01 = { x: u0 * img.width, y: v1 * img.height };
      const d00 = quadPoint(corners, u0, v0);
      const d10 = quadPoint(corners, u1, v0);
      const d11 = quadPoint(corners, u1, v1);
      const d01 = quadPoint(corners, u0, v1);
      drawTriangle(ctx, img, [s00, s10, s11], [d00, d10, d11]);
      drawTriangle(ctx, img, [s00, s11, s01], [d00, d11, d01]);
    }
  }
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

async function renderAnalyticsBlock(input: ExportInput): Promise<{ dataUrl: string; ratio: number } | null> {
  const d = input.analytics;
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-99999px;top:0;width:520px;padding:18px;background:#fff;font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:#0f172a;box-sizing:border-box;";
  if (!d || !d.ok) {
    host.innerHTML = `<div style="font-size:15px;font-weight:700;color:#17365D;border-bottom:2px solid #17365D;padding-bottom:6px;margin-bottom:10px;">Analytics</div><div style="font-size:12px;color:#dc2626;line-height:1.45;">${escapeHtml(d?.error ?? "ยังไม่มีข้อมูล Analytics")}</div>`;
  } else {
    const demoRows = Object.entries(d.demographics)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `<span style="display:inline-block;margin-right:10px;white-space:nowrap;">${escapeHtml(demoLabel(k))} <b>${v}%</b></span>`)
      .join("");
    const bucketRows = d.buckets.slice(0, 6).map((b) => {
      const max = Math.max(...d.buckets.map((x) => x.count), 1);
      const pct = Math.max(4, Math.round((b.count / max) * 100));
      return `<div style="display:flex;align-items:center;gap:6px;margin:4px 0;font-size:11px;"><span style="width:18px;">${b.icon}</span><span style="width:118px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(b.label)}</span><span style="height:7px;flex:1;background:#e2e8f0;border-radius:10px;overflow:hidden;"><span style="display:block;height:7px;width:${pct}%;background:${b.color};"></span></span><b style="width:24px;text-align:right;">${b.count}</b></div>`;
    }).join("");
    const topRows = d.topPOIs.slice(0, 5).map((p) =>
      `<div style="display:flex;gap:8px;font-size:10.5px;margin:2px 0;"><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.name)}</span><span style="color:#64748b;white-space:nowrap;">${escapeHtml(p.category)}</span><b style="width:42px;text-align:right;">${p.distanceM}ม.</b></div>`,
    ).join("");
    host.innerHTML = `
      <div style="font-size:15px;font-weight:700;color:#17365D;border-bottom:2px solid #17365D;padding-bottom:6px;margin-bottom:8px;">Analytics</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <div style="background:#f1f5f9;border:1px solid #dbe3ef;border-radius:6px;padding:8px;"><div style="font-size:10px;color:#64748b;">Traffic</div><div style="font-size:24px;font-weight:800;color:#17365D;">${d.trafficScore}<span style="font-size:12px;font-weight:500;">/100</span></div><div style="font-size:11px;">${escapeHtml(d.trafficLabel)}</div></div>
        <div style="background:#f1f5f9;border:1px solid #dbe3ef;border-radius:6px;padding:8px;"><div style="font-size:10px;color:#64748b;">Impressions/day</div><div style="font-size:15px;font-weight:800;color:#17365D;margin-top:5px;">${d.estimatedDailyImpressions.min.toLocaleString()}–${d.estimatedDailyImpressions.max.toLocaleString()}</div><div style="font-size:10px;color:#64748b;margin-top:3px;">${escapeHtml(d.nearestRoad?.name ?? d.nearestRoad?.class ?? "ไม่พบถนน")}</div></div>
      </div>
      <div style="font-size:11px;margin-bottom:8px;line-height:1.35;"><b>กลุ่มเป้าหมาย:</b> ${demoRows}</div>
      <div style="font-size:11px;margin-bottom:6px;"><b>ช่วงพีค:</b> ${d.peakHours.map(escapeHtml).join(" · ") || "—"}</div>
      <div style="font-size:11px;font-weight:700;margin-top:6px;">POI รอบป้าย (${d.totalPOIs.toLocaleString()})</div>
      ${bucketRows || `<div style="font-size:11px;color:#64748b;margin:4px 0;">ไม่พบ POI ในรัศมีนี้</div>`}
      ${topRows ? `<div style="font-size:11px;font-weight:700;margin-top:8px;">ใกล้ที่สุด</div>${topRows}` : ""}
      ${d.notes.length ? `<div style="margin-top:8px;font-size:10.5px;color:#475569;line-height:1.35;">${d.notes.slice(0, 2).map(escapeHtml).join(" · ")}</div>` : ""}
    `;
  }
  document.body.appendChild(host);
  try {
    const snap = await snapshotNode(host);
    if (!snap) return null;
    return { dataUrl: snap.dataUrl, ratio: snap.width / snap.height };
  } finally {
    host.remove();
  }
}

function demoLabel(k: string): string {
  switch (k) {
    case "office": return "ออฟฟิศ";
    case "student": return "นักเรียน";
    case "shopper": return "นักช้อป";
    case "resident": return "ที่อยู่อาศัย";
    case "tourist": return "นักท่องเที่ยว";
    default: return k;
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

  const analytics = await renderAnalyticsBlock(input);
  if (analytics) {
    const analyticsW = 4.7;
    const analyticsH = Math.min(analyticsW / analytics.ratio, 3.85);
    s1.addImage({ data: analytics.dataUrl, x: 8.2, y: 3.05, w: analyticsW, h: analyticsH });
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
    pdf.addImage(info.dataUrl, "PNG", margin + heroW + margin, 60, infoW, Math.min(infoH, 172));
  }

  const analytics = await renderAnalyticsBlock(input);
  if (analytics) {
    const analyticsW = pageW - (margin + heroW + margin) - margin;
    const analyticsH = Math.min(analyticsW / analytics.ratio, pageH - 275);
    pdf.addImage(analytics.dataUrl, "PNG", margin + heroW + margin, 245, analyticsW, analyticsH);
  }

  await drawTextImage(
    `สร้างเมื่อ ${new Date().toLocaleString("th-TH")} · Asset History 360`,
    { x: margin, y: pageH - 22, w: pageW - margin * 2, fontSize: 8, italic: true, color: "#94A3B8" },
  );

  pdf.save(`billboard-${input.asset.old_code ?? "report"}.pdf`);
}

export async function fetchImageAsDataUrl(url: string): Promise<string> {
  return await urlToDataUrl(url);
}
