// Client-side export of billboard reports as PPTX or PDF.
import pptxgen from "pptxgenjs";
import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";
import type { BillboardAnalytics } from "@/lib/billboard-analytics.functions";
import type { BillboardMockup, BillboardMockupOverlay } from "@/lib/billboard-mockups.functions";
import type { MapAsset } from "@/lib/map.functions";
import type { NearbyPOI } from "@/lib/poi-search.functions";
import { PRESET_BY_KEY } from "@/lib/overpass";

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
  /** Nearby POIs (OSM) already filtered by nearbyRadiusM. Rendered on slide/page 2. */
  nearbyPois?: NearbyPOI[];
  nearbyRadiusM?: number;
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
        const url = best.toDataURL("image/jpeg", 0.96);
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
    return canvas.toDataURL("image/jpeg", 0.96);
  } catch (e) {
    console.warn("captureStreetViewNode failed", e);
    return null;
  }
}

// Return a canvas the same size as `img`, with brightness applied and edges
// feathered to transparent over `featherPx` pixels so the mockup blends softly
// into Street View instead of showing a hard sharp border.
function prepareMockupSource(
  img: HTMLImageElement,
  brightness: number,
  featherPx: number,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  if (!g) return c;
  if (brightness !== 1) g.filter = `brightness(${brightness})`;
  g.drawImage(img, 0, 0);
  g.filter = "none";
  const fp = Math.max(0, Math.min(featherPx, Math.floor(Math.min(img.width, img.height) / 4)));
  if (fp > 0) {
    g.globalCompositeOperation = "destination-out";
    const fade = (x: number, y: number, w: number, h: number, gx0: number, gy0: number, gx1: number, gy1: number) => {
      const grad = g.createLinearGradient(gx0, gy0, gx1, gy1);
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(x, y, w, h);
    };
    fade(0, 0, img.width, fp, 0, 0, 0, fp);                              // top
    fade(0, img.height - fp, img.width, fp, 0, img.height, 0, img.height - fp); // bottom
    fade(0, 0, fp, img.height, 0, 0, fp, 0);                             // left
    fade(img.width - fp, 0, fp, img.height, img.width, 0, img.width - fp, 0);   // right
    g.globalCompositeOperation = "source-over";
  }
  return c;
}

// Compose Street View + mockup overlay into a single JPEG data URL via a canvas.
export async function composeStreetViewWithOverlay(
  streetViewDataUrl: string,
  mockupDataUrl: string,
  overlay: BillboardMockupOverlay,
): Promise<string> {
  const sv = await loadImage(streetViewDataUrl);
  const mk = await loadImage(mockupDataUrl);
  // Upscale the composed canvas so the mockup (especially small text) stays
  // readable in PDF/PPTX. Aim for at least 1920 px wide.
  const MIN_W = 1920;
  const scale = Math.max(1, MIN_W / Math.max(1, sv.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sv.width * scale);
  canvas.height = Math.round(sv.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return streetViewDataUrl;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sv, 0, 0, canvas.width, canvas.height);
  const brightness = overlay.brightness ?? 1;
  // Feather ~2 CSS px worth of source pixels so the mockup border softens.
  const featherPx = Math.max(2, Math.round(Math.min(mk.width, mk.height) * 0.01));
  const prepared = prepareMockupSource(mk, brightness, featherPx);
  ctx.globalAlpha = overlay.opacity;
  const x = (overlay.x / 100) * canvas.width;
  const y = (overlay.y / 100) * canvas.height;
  const w = (overlay.w / 100) * canvas.width;
  const h = (overlay.h / 100) * canvas.height;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (overlay.rotation) ctx.rotate((overlay.rotation * Math.PI) / 180);
  const skewX = ((overlay.skewX ?? 0) * Math.PI) / 180;
  const skewY = ((overlay.skewY ?? 0) * Math.PI) / 180;
  if (skewX || skewY) ctx.transform(1, Math.tan(skewY), Math.tan(skewX), 1, 0, 0);
  ctx.drawImage(prepared, -w / 2, -h / 2, w, h);
  ctx.restore();
  if (overlay.corners) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(sv, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = overlay.opacity;
    drawImageInQuad(ctx, prepared, [overlay.corners.tl, overlay.corners.tr, overlay.corners.br, overlay.corners.bl].map((p) => ({
      x: (p.x / 100) * canvas.width,
      y: (p.y / 100) * canvas.height,
    })));
    ctx.globalAlpha = 1;
  }
  return canvas.toDataURL("image/jpeg", 0.96);
}

function interp(a: CornerPoint, b: CornerPoint, t: number): CornerPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function quadPoint(c: CornerPoint[], u: number, v: number): CornerPoint {
  const top = interp(c[0], c[1], u);
  const bottom = interp(c[3], c[2], u);
  return interp(top, bottom, v);
}

function inflateTriangle(
  d: [CornerPoint, CornerPoint, CornerPoint],
  amount: number,
): [CornerPoint, CornerPoint, CornerPoint] {
  const cx = (d[0].x + d[1].x + d[2].x) / 3;
  const cy = (d[0].y + d[1].y + d[2].y) / 3;
  const push = (p: CornerPoint): CornerPoint => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * amount, y: p.y + (dy / len) * amount };
  };
  return [push(d[0]), push(d[1]), push(d[2])];
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  src: [CornerPoint, CornerPoint, CornerPoint],
  dst: [CornerPoint, CornerPoint, CornerPoint],
) {
  const [s0, s1, s2] = src;
  // Inflate the destination triangle slightly so adjacent triangles overlap and
  // hide the diagonal seams that otherwise show as faint stripes across the mockup.
  const [d0, d1, d2] = inflateTriangle(dst, 0.75);
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

function drawImageInQuad(ctx: CanvasRenderingContext2D, img: HTMLImageElement | HTMLCanvasElement, corners: CornerPoint[]) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Larger cells + slight triangle inflation eliminate diagonal seam stripes.
  const steps = 6;
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

async function getImageDims(src: string): Promise<{ width: number; height: number }> {
  try {
    const img = await loadImage(src);
    return { width: img.naturalWidth || img.width || 16, height: img.naturalHeight || img.height || 9 };
  } catch {
    return { width: 16, height: 9 };
  }
}

// Cover-crop an image data URL to exactly match targetRatio (w/h).
// This is object-fit:cover in a canvas — no black letterbox bars.
async function coverCropToRatio(dataUrl: string, targetRatio: number): Promise<string> {
  try {
    const img = await loadImage(dataUrl);
    const srcRatio = img.width / img.height;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (srcRatio > targetRatio) {
      // Source wider → crop sides
      sw = img.height * targetRatio;
      sx = (img.width - sw) / 2;
    } else {
      // Source taller → crop top/bottom
      sh = img.width / targetRatio;
      sy = (img.height - sh) / 2;
    }
    const canvas = document.createElement("canvas");
    // Target ~1920 wide for crisp export
    const outW = Math.max(1600, Math.round(sw));
    const outH = Math.round(outW / targetRatio);
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    return canvas.toDataURL("image/jpeg", 0.94);
  } catch {
    return dataUrl;
  }
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
// Single-slide, airy layout — everything is native pptxgen text/shape so end
// users can double-click and edit in PowerPoint. Thai renders via Tahoma
// (ships with every Office install).
const TH_FONT = "Tahoma";

function demoLabelTh(k: string): string {
  return demoLabel(k);
}

// Truncate long POI names so they don't overflow their column.
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export async function exportBillboardPptx(input: ExportInput): Promise<void> {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
  const BRAND = "17365D";
  const MUTED = "64748B";
  const SUBTLE = "94A3B8";
  const BORDER = "DBE3EF";
  const SURFACE = "F8FAFC";
  const TEXT = "0F172A";

  const s1 = pres.addSlide();
  s1.background = { color: "FFFFFF" };

  // ---- Header ---- (title left, address centered — no date, no duplicate subtitle)
  s1.addShape("rect", { x: 0, y: 0, w: 13.333, h: 0.6, fill: { color: BRAND } });
  s1.addText(
    `Billboard Report · ${input.asset.old_code ?? "—"}`,
    {
      x: 0.4, y: 0.1, w: 5.2, h: 0.4,
      fontSize: 16, bold: true, color: "FFFFFF", fontFace: TH_FONT, valign: "middle",
    },
  );
  s1.addText(
    `${input.asset.location ?? input.asset.name ?? ""}`,
    {
      x: 5.6, y: 0.1, w: 7.3, h: 0.4,
      fontSize: 12, color: "E2E8F0", fontFace: TH_FONT, align: "center", valign: "middle",
    },
  );

  // ---- LEFT column ----
  const leftX = 0.35;
  const leftW = 7.5;

  // Hero image — fit box to image's natural aspect ratio so nothing is cropped
  // (previous cover-crop chopped the billboard off) and nothing is letterboxed.
  const heroY = 0.85;
  const HERO_MIN_H = 2.8;
  const HERO_MAX_H = 3.75;
  const hero = await buildHeroImage(input);
  let heroH = 3.8;
  let heroW = leftW;
  let heroXAligned = leftX;
  if (hero) {
    const dims = await getImageDims(hero);
    const naturalRatio = dims.width / dims.height;
    // Fit-to-box preserving aspect: if height would exceed max, shrink width;
    // never stretch width to fill.
    const wIfMaxH = HERO_MAX_H * naturalRatio;
    const hIfFullW = leftW / naturalRatio;
    if (hIfFullW <= HERO_MAX_H) {
      heroW = leftW;
      heroH = Math.max(HERO_MIN_H, hIfFullW);
    } else {
      heroH = HERO_MAX_H;
      heroW = Math.min(leftW, wIfMaxH);
    }
    heroXAligned = leftX + (leftW - heroW) / 2;
    s1.addImage({ data: hero, x: heroXAligned, y: heroY, w: heroW, h: heroH });
  } else {
    s1.addShape("rect", {
      x: leftX, y: heroY, w: leftW, h: heroH,
      fill: { color: SURFACE }, line: { color: BORDER, width: 1 },
    });
    s1.addText("(ไม่มีภาพ Street View)", {
      x: leftX, y: heroY + heroH / 2 - 0.15, w: leftW, h: 0.3,
      fontSize: 12, color: SUBTLE, align: "center", fontFace: TH_FONT,
    });
  }
  s1.addText("Street View + Ad Mockup", {
    x: leftX, y: heroY + heroH + 0.05, w: leftW, h: 0.22,
    fontSize: 9, italic: true, color: MUTED, fontFace: TH_FONT,
  });

  // POI blocks (below hero)
  const poiTop = heroY + heroH + 0.4;
  const poiH = 2.15;
  const d = input.analytics;

  // Panel background for POI section
  s1.addShape("rect", {
    x: leftX, y: poiTop, w: leftW, h: poiH,
    fill: { color: "FFFFFF" }, line: { color: BORDER, width: 1 },
  });
  s1.addText(
    d && d.ok ? `POI รอบป้าย (${d.totalPOIs.toLocaleString()} แห่ง)` : "POI รอบป้าย",
    {
      x: leftX + 0.15, y: poiTop + 0.06, w: leftW - 0.3, h: 0.28,
      fontSize: 12, bold: true, color: BRAND, fontFace: TH_FONT,
    },
  );

  if (d && d.ok) {
    // Left half: bucket bars (top 5)
    const bucketAreaX = leftX + 0.15;
    const bucketAreaW = leftW / 2 - 0.25;
    const bucketTop = poiTop + 0.38;
    const buckets = d.buckets.slice(0, 5);
    const bkRowH = 0.28;
    const maxCount = Math.max(...buckets.map((b) => b.count), 1);
    buckets.forEach((b, i) => {
      const y = bucketTop + i * bkRowH;
      s1.addText(`${b.icon} ${b.label}`, {
        x: bucketAreaX, y, w: bucketAreaW * 0.55, h: bkRowH,
        fontSize: 9, color: TEXT, fontFace: TH_FONT, valign: "middle",
      });
      const barX = bucketAreaX + bucketAreaW * 0.55;
      const barW = bucketAreaW * 0.35;
      s1.addShape("rect", {
        x: barX, y: y + 0.09, w: barW, h: 0.09,
        fill: { color: "E2E8F0" }, line: { color: "E2E8F0" },
      });
      s1.addShape("rect", {
        x: barX, y: y + 0.09, w: Math.max(0.05, barW * (b.count / maxCount)), h: 0.09,
        fill: { color: b.color.replace("#", "") }, line: { color: b.color.replace("#", "") },
      });
      s1.addText(String(b.count), {
        x: bucketAreaX + bucketAreaW - 0.35, y, w: 0.35, h: bkRowH,
        fontSize: 9, bold: true, color: TEXT, fontFace: TH_FONT, align: "right", valign: "middle",
      });
    });

    // Right half: POI list top 10 (2 columns of 5)
    const listX = leftX + leftW / 2 + 0.1;
    const listW = leftW / 2 - 0.25;
    const listTop = poiTop + 0.38;
    s1.addText("ใกล้ที่สุด (Top 10)", {
      x: listX, y: listTop - 0.3, w: listW, h: 0.22,
      fontSize: 9, bold: true, color: MUTED, fontFace: TH_FONT,
    });
    const pois = d.topPOIs.slice(0, 10);
    const rowH = 0.16;
    pois.forEach((p, i) => {
      const y = listTop + i * rowH;
      s1.addText(`${i + 1}. ${truncate(p.name, 22)}`, {
        x: listX, y, w: listW * 0.6, h: rowH,
        fontSize: 8, color: TEXT, fontFace: TH_FONT, valign: "middle",
      });
      s1.addText(`${p.distanceM} ม.`, {
        x: listX + listW - 0.6, y, w: 0.6, h: rowH,
        fontSize: 8, bold: true, color: TEXT, fontFace: TH_FONT, align: "right", valign: "middle",
      });
    });
  } else {
    s1.addText(d?.error ?? "ยังไม่มีข้อมูล Analytics", {
      x: leftX + 0.15, y: poiTop + 0.5, w: leftW - 0.3, h: 0.5,
      fontSize: 10, color: "DC2626", fontFace: TH_FONT,
    });
  }

  // ---- RIGHT column ----
  const rightX = 8.05;
  const rightW = 4.95;
  const a = input.asset;

  // Info card
  const infoY = 0.85;
  const infoH = 2.05;
  s1.addShape("rect", {
    x: rightX, y: infoY, w: rightW, h: infoH,
    fill: { color: "FFFFFF" }, line: { color: BORDER, width: 1 },
  });
  s1.addText("ข้อมูลป้าย", {
    x: rightX + 0.15, y: infoY + 0.08, w: rightW - 0.3, h: 0.28,
    fontSize: 12, bold: true, color: BRAND, fontFace: TH_FONT,
  });
  const infoRows: [string, string][] = [
    ["รหัส", a.old_code ?? "—"],
    ["ชื่อ", a.name ?? a.location ?? "—"],
    ["Department", a.department ?? "—"],
    ["Media Type", a.media_type ?? "—"],
    ["Location", a.location ?? "—"],
    ["สถานะ", a.status ?? "—"],
    ["พิกัด", `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}`],
  ];
  const infoRowsTop = infoY + 0.42;
  const infoRowH = 0.22;
  infoRows.forEach(([k, v], i) => {
    const y = infoRowsTop + i * infoRowH;
    s1.addText(k, {
      x: rightX + 0.15, y, w: 1.3, h: infoRowH,
      fontSize: 9, bold: true, color: "475569", fontFace: TH_FONT, valign: "top",
    });
    s1.addText(v, {
      x: rightX + 1.45, y, w: rightW - 1.6, h: infoRowH,
      fontSize: 9, color: TEXT, fontFace: TH_FONT, valign: "top",
    });
  });

  // KPI cards (Traffic + Impressions)
  const kpiY = infoY + infoH + 0.2;
  const kpiH = 1.05;
  const kpiGap = 0.15;
  const kpiW = (rightW - kpiGap) / 2;
  const trafficScore = d?.ok ? d.trafficScore : 0;
  const trafficLabel = d?.ok ? d.trafficLabel : "—";
  const impMin = d?.ok ? d.estimatedDailyImpressions.min : 0;
  const impMax = d?.ok ? d.estimatedDailyImpressions.max : 0;
  const roadTxt = d?.ok ? (d.nearestRoad?.name ?? d.nearestRoad?.class ?? "ไม่พบถนน") : "—";

  // Traffic KPI
  s1.addShape("roundRect", {
    x: rightX, y: kpiY, w: kpiW, h: kpiH,
    fill: { color: SURFACE }, line: { color: BORDER, width: 1 }, rectRadius: 0.06,
  });
  s1.addText("Traffic", {
    x: rightX + 0.15, y: kpiY + 0.08, w: kpiW - 0.3, h: 0.22,
    fontSize: 9, color: MUTED, fontFace: TH_FONT,
  });
  s1.addText(
    [
      { text: `${trafficScore}`, options: { fontSize: 28, bold: true, color: BRAND } },
      { text: " /100", options: { fontSize: 11, color: MUTED } },
    ],
    { x: rightX + 0.15, y: kpiY + 0.3, w: kpiW - 0.3, h: 0.5, fontFace: TH_FONT },
  );
  s1.addText(trafficLabel, {
    x: rightX + 0.15, y: kpiY + 0.78, w: kpiW - 0.3, h: 0.22,
    fontSize: 10, bold: true, color: TEXT, fontFace: TH_FONT,
  });

  // Impressions KPI
  const kpi2X = rightX + kpiW + kpiGap;
  s1.addShape("roundRect", {
    x: kpi2X, y: kpiY, w: kpiW, h: kpiH,
    fill: { color: SURFACE }, line: { color: BORDER, width: 1 }, rectRadius: 0.06,
  });
  s1.addText("Impressions/day", {
    x: kpi2X + 0.15, y: kpiY + 0.08, w: kpiW - 0.3, h: 0.22,
    fontSize: 9, color: MUTED, fontFace: TH_FONT,
  });
  s1.addText(
    `${impMin.toLocaleString()}–${impMax.toLocaleString()}`,
    { x: kpi2X + 0.15, y: kpiY + 0.32, w: kpiW - 0.3, h: 0.4,
      fontSize: 14, bold: true, color: BRAND, fontFace: TH_FONT },
  );
  s1.addText(roadTxt, {
    x: kpi2X + 0.15, y: kpiY + 0.78, w: kpiW - 0.3, h: 0.22,
    fontSize: 9, color: MUTED, fontFace: TH_FONT,
  });

  // Demographics card
  const demY = kpiY + kpiH + 0.2;
  const demH = 1.85;
  s1.addShape("rect", {
    x: rightX, y: demY, w: rightW, h: demH,
    fill: { color: "FFFFFF" }, line: { color: BORDER, width: 1 },
  });
  s1.addText("กลุ่มเป้าหมาย (Demographics)", {
    x: rightX + 0.15, y: demY + 0.08, w: rightW - 0.3, h: 0.24,
    fontSize: 11, bold: true, color: BRAND, fontFace: TH_FONT,
  });
  if (d && d.ok) {
    const demRows = (Object.entries(d.demographics) as Array<[string, number]>)
      .sort((a, b) => b[1] - a[1]);
    const demRowsTop = demY + 0.42;
    const demRowH = 0.26;
    const demColors: Record<string, string> = {
      office: "3b82f6",
      student: "6366f1",
      shopper: "a855f7",
      resident: "059669",
      tourist: "f59e0b",
    };
    demRows.forEach(([k, v], i) => {
      const y = demRowsTop + i * demRowH;
      s1.addText(demoLabelTh(k), {
        x: rightX + 0.15, y, w: 1.55, h: demRowH,
        fontSize: 9, color: TEXT, fontFace: TH_FONT, valign: "middle",
      });
      const barX = rightX + 1.75;
      const barW = rightW - 2.7;
      s1.addShape("rect", {
        x: barX, y: y + 0.09, w: barW, h: 0.08,
        fill: { color: "E2E8F0" }, line: { color: "E2E8F0" },
      });
      s1.addShape("rect", {
        x: barX, y: y + 0.09, w: Math.max(0.04, barW * (v / 100)), h: 0.08,
        fill: { color: demColors[k] ?? "94A3B8" }, line: { color: demColors[k] ?? "94A3B8" },
      });
      s1.addText(`${v}%`, {
        x: rightX + rightW - 0.85, y, w: 0.75, h: demRowH,
        fontSize: 9, bold: true, color: TEXT, fontFace: TH_FONT, align: "right", valign: "middle",
      });
    });
  }

  // Peak hours line
  const peakY = demY + demH + 0.15;
  s1.addText(
    [
      { text: "ช่วงพีค: ", options: { bold: true, color: BRAND } },
      { text: d?.ok ? d.peakHours.join("   ·   ") || "—" : "—", options: { color: TEXT } },
    ],
    { x: rightX, y: peakY, w: rightW, h: 0.28,
      fontSize: 10, fontFace: TH_FONT },
  );

  // Footer
  s1.addText(
    `สร้างเมื่อ ${new Date().toLocaleString("th-TH")} · Asset History 360 · แก้ไขข้อความได้ทุกกล่อง`,
    { x: 0.4, y: 7.2, w: 12.5, h: 0.25, fontSize: 8, italic: true, color: SUBTLE, fontFace: TH_FONT },
  );

  // ---------- Slide 2 — Nearby POIs (OSM) with clickable Google Maps hyperlinks ----------
  addNearbyPoiSlide(pres, input, { BRAND, MUTED, SUBTLE, BORDER, SURFACE, TEXT, TH_FONT });

  await pres.writeFile({ fileName: `billboard-${input.asset.old_code ?? "report"}.pptx` });
}

type PptxTheme = { BRAND: string; MUTED: string; SUBTLE: string; BORDER: string; SURFACE: string; TEXT: string; TH_FONT: string };

function addNearbyPoiSlide(pres: pptxgen, input: ExportInput, t: PptxTheme): void {
  const nearby = input.nearbyPois ?? [];
  if (nearby.length === 0) return;

  const s2 = pres.addSlide();
  s2.background = { color: "FFFFFF" };

  // Header bar
  s2.addShape("rect", { x: 0, y: 0, w: 13.333, h: 0.6, fill: { color: t.BRAND } });
  s2.addText(
    `Nearby POIs · ${input.asset.old_code ?? "—"}`,
    { x: 0.4, y: 0.1, w: 6.5, h: 0.4, fontSize: 16, bold: true, color: "FFFFFF", fontFace: t.TH_FONT, valign: "middle" },
  );
  const radiusM = input.nearbyRadiusM ?? 500;
  s2.addText(
    `รัศมี ${radiusM >= 1000 ? `${radiusM / 1000} กม.` : `${radiusM} ม.`} · ${nearby.length} แห่ง (คลิกชื่อเพื่อเปิด Google Maps)`,
    { x: 6.9, y: 0.1, w: 6.0, h: 0.4, fontSize: 11, color: "E2E8F0", fontFace: t.TH_FONT, align: "right", valign: "middle" },
  );

  // Group by preset
  const groups = new Map<string, NearbyPOI[]>();
  for (const p of nearby) {
    const arr = groups.get(p.presetKey) ?? [];
    arr.push(p);
    groups.set(p.presetKey, arr);
  }
  const entries = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);

  // 3-column grid of cards
  const cols = 3;
  const gap = 0.2;
  const marginX = 0.35;
  const gridTop = 0.85;
  const gridW = 13.333 - marginX * 2;
  const cardW = (gridW - gap * (cols - 1)) / cols;
  const cardH = 2.1;
  const rowH = 0.22;
  const maxPerCard = 6;

  entries.forEach((entry, idx) => {
    const [key, list] = entry;
    const preset = PRESET_BY_KEY[key];
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = marginX + col * (cardW + gap);
    const y = gridTop + row * (cardH + gap);

    // Guard: max 3 rows on the slide
    if (y + cardH > 7.1) return;

    s2.addShape("rect", {
      x, y, w: cardW, h: cardH,
      fill: { color: "FFFFFF" }, line: { color: t.BORDER, width: 1 },
    });
    // Header strip
    const headColor = (preset?.color ?? "#94a3b8").replace("#", "");
    s2.addShape("rect", {
      x, y, w: cardW, h: 0.32,
      fill: { color: headColor + "22" }, line: { color: headColor + "22" },
    });
    s2.addText(
      `${preset?.icon ?? "📍"}  ${preset?.label ?? key}   (${list.length})`,
      { x: x + 0.12, y: y + 0.04, w: cardW - 0.24, h: 0.24, fontSize: 10, bold: true, color: headColor, fontFace: t.TH_FONT, valign: "middle" },
    );

    // POI rows (clickable hyperlink)
    list.slice(0, maxPerCard).forEach((poi, i) => {
      const ry = y + 0.4 + i * rowH;
      const url = `https://www.google.com/maps?q=${poi.lat},${poi.lng}`;
      s2.addText(
        [
          { text: truncate(poi.name, 32), options: { color: t.TEXT, hyperlink: { url, tooltip: "เปิดใน Google Maps" } } },
        ],
        { x: x + 0.12, y: ry, w: cardW - 0.9, h: rowH, fontSize: 9, fontFace: t.TH_FONT, valign: "middle" },
      );
      s2.addText(`${Math.round(poi.distanceM)} ม.`, {
        x: x + cardW - 0.75, y: ry, w: 0.65, h: rowH,
        fontSize: 9, bold: true, color: t.MUTED, fontFace: t.TH_FONT, align: "right", valign: "middle",
      });
    });
    if (list.length > maxPerCard) {
      const ry = y + 0.4 + maxPerCard * rowH;
      s2.addText(`+ อีก ${list.length - maxPerCard} แห่ง`, {
        x: x + 0.12, y: ry, w: cardW - 0.24, h: rowH,
        fontSize: 8, italic: true, color: t.SUBTLE, fontFace: t.TH_FONT,
      });
    }
  });

  s2.addText(
    `สร้างเมื่อ ${new Date().toLocaleString("th-TH")} · Asset History 360 · ข้อมูลจาก OpenStreetMap`,
    { x: 0.4, y: 7.2, w: 12.5, h: 0.25, fontSize: 8, italic: true, color: t.SUBTLE, fontFace: t.TH_FONT },
  );
}


// ============ PDF ============
// jsPDF shell with html2canvas-pro snapshots for every Thai text region.
// Layout mirrors the PPTX for visual consistency.
export async function exportBillboardPdf(input: ExportInput): Promise<void> {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const BRAND = "#17365D";

  // Header — title left, address centered, no date
  pdf.setFillColor(23, 54, 93);
  pdf.rect(0, 0, pageW, 40, "F");
  await drawTextImage(pdf, `Billboard Report · ${input.asset.old_code ?? "-"}`, {
    x: margin, y: 10, w: pageW * 0.42, fontSize: 14, bold: true, color: "#ffffff",
  });
  await drawTextImage(pdf, `${input.asset.location ?? input.asset.name ?? ""}`, {
    x: pageW * 0.42, y: 13, w: pageW - margin - pageW * 0.42, fontSize: 11, color: "#e2e8f0",
    align: "center",
  });

  // Hero (left) — fit box to natural aspect (no crop, no letterbox)
  const heroX = margin;
  const heroY = 55;
  const heroW = pageW * 0.55;
  const HERO_MAX_H_PDF = 260;
  const HERO_MIN_H_PDF = 180;
  const hero = await buildHeroImage(input);
  let heroH = 250;
  if (hero) {
    try {
      const dims = await getImageDims(hero);
      const naturalRatio = dims.width / dims.height;
      heroH = Math.max(HERO_MIN_H_PDF, Math.min(HERO_MAX_H_PDF, heroW / naturalRatio));
      pdf.addImage(hero, "JPEG", heroX, heroY, heroW, heroH);
    } catch {
      // ignore
    }
  } else {
    pdf.setDrawColor(200);
    pdf.rect(heroX, heroY, heroW, heroH);
    await drawTextImage(pdf, "(ไม่มีภาพ Street View)", {
      x: heroX, y: heroY + heroH / 2 - 10, w: heroW, fontSize: 11, color: "#94A3B8", align: "center",
    });
  }
  await drawTextImage(pdf, "Street View + Ad Mockup", {
    x: heroX, y: heroY + heroH + 4, w: heroW, fontSize: 8, italic: true, color: "#64748b",
  });

  // Info block (right top)
  const rightX = heroX + heroW + 16;
  const rightW = pageW - rightX - margin;
  const info = await renderInfoBlock(input);
  let infoBottom = heroY;
  if (info) {
    const infoH = Math.min(rightW / info.ratio, 130);
    pdf.addImage(info.dataUrl, "PNG", rightX, heroY, rightW, infoH);
    infoBottom = heroY + infoH;
  }

  // Analytics block (right, below info)
  const analytics = await renderAnalyticsBlock(input);
  if (analytics) {
    const anTop = infoBottom + 10;
    const anMaxH = pageH - anTop - 30;
    const anH = Math.min(rightW / analytics.ratio, anMaxH);
    pdf.addImage(analytics.dataUrl, "PNG", rightX, anTop, rightW, anH);
  }

  // POI list block (bottom-left, under hero)
  const poi = await renderPoiListBlock(input);
  if (poi) {
    const poiTop = heroY + heroH + 22;
    const poiMaxH = pageH - poiTop - 30;
    const poiH2 = Math.min(heroW / poi.ratio, poiMaxH);
    pdf.addImage(poi.dataUrl, "PNG", heroX, poiTop, heroW, poiH2);
  }

  await drawTextImage(pdf, `สร้างเมื่อ ${new Date().toLocaleString("th-TH")} · Asset History 360`, {
    x: margin, y: pageH - 20, w: pageW - margin * 2, fontSize: 8, italic: true, color: "#94A3B8",
  });

  // Second page — Nearby POIs (OSM). Uses on-the-fly HTML block so Thai text
  // and hyperlinks render correctly through html2canvas-pro snapshot.
  const nearby = input.nearbyPois ?? [];
  if (nearby.length > 0) {
    pdf.addPage("a4", "landscape");
    const title = `Nearby POIs · ${input.asset.old_code ?? "—"} · รัศมี ${
      (input.nearbyRadiusM ?? 500) >= 1000
        ? `${(input.nearbyRadiusM ?? 500) / 1000} กม.`
        : `${input.nearbyRadiusM ?? 500} ม.`
    } · ${nearby.length} แห่ง`;
    await drawTextImage(pdf, title, {
      x: margin, y: margin, w: pageW - margin * 2, fontSize: 16, bold: true, color: "#0F172A",
    });
    const block = await renderNearbyPoiBlock(nearby);
    if (block) {
      const blockTop = margin + 30;
      const blockH = Math.min((pageW - margin * 2) / block.ratio, pageH - blockTop - 30);
      pdf.addImage(block.dataUrl, "PNG", margin, blockTop, pageW - margin * 2, blockH);
    }
    await drawTextImage(
      pdf,
      `ข้อมูลจาก OpenStreetMap · คลิกที่ชื่อ POI เพื่อเปิดใน Google Maps`,
      { x: margin, y: pageH - 20, w: pageW - margin * 2, fontSize: 8, italic: true, color: "#94A3B8" },
    );
  }

  pdf.save(`billboard-${input.asset.old_code ?? "report"}.pdf`);
}

async function renderNearbyPoiBlock(pois: NearbyPOI[]): Promise<{ dataUrl: string; ratio: number } | null> {
  const groups = new Map<string, NearbyPOI[]>();
  for (const p of pois) {
    const arr = groups.get(p.presetKey) ?? [];
    arr.push(p);
    groups.set(p.presetKey, arr);
  }
  const entries = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  if (entries.length === 0) return null;

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:1600px;background:#fff;padding:12px;font-family:${TH_FONT},system-ui,sans-serif;color:#0f172a;`;
  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:12px;";
  for (const [key, list] of entries) {
    const preset = PRESET_BY_KEY[key];
    const color = preset?.color ?? "#94a3b8";
    const card = document.createElement("div");
    card.style.cssText = "border:1px solid #dbe3ef;border-radius:8px;overflow:hidden;background:#fff;";
    const head = document.createElement("div");
    head.style.cssText = `padding:6px 10px;background:${color}22;color:${color};font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px;`;
    head.innerHTML = `<span>${preset?.icon ?? "📍"}</span><span>${escapeHtml(preset?.label ?? key)}</span><span style="margin-left:auto;color:#64748b;font-weight:600;">${list.length}</span>`;
    card.appendChild(head);
    const ul = document.createElement("ul");
    ul.style.cssText = "list-style:none;margin:0;padding:0;";
    list.slice(0, 8).forEach((poi) => {
      const li = document.createElement("li");
      li.style.cssText = "padding:5px 10px;border-top:1px solid #eef2f7;font-size:12px;display:flex;align-items:center;gap:6px;";
      const url = `https://www.google.com/maps?q=${poi.lat},${poi.lng}`;
      li.innerHTML = `<a href="${url}" style="color:#0f172a;text-decoration:none;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(poi.name)}</a><span style="color:#64748b;font-weight:600;white-space:nowrap;">${Math.round(poi.distanceM)} ม.</span>`;
      ul.appendChild(li);
    });
    if (list.length > 8) {
      const li = document.createElement("li");
      li.style.cssText = "padding:4px 10px;border-top:1px solid #eef2f7;font-size:11px;color:#94a3b8;text-align:center;background:#f8fafc;";
      li.textContent = `+ อีก ${list.length - 8} แห่ง`;
      ul.appendChild(li);
    }
    card.appendChild(ul);
    grid.appendChild(card);
  }
  host.appendChild(grid);
  document.body.appendChild(host);
  try {
    const snap = await snapshotNode(host);
    if (!snap) return null;
    return { dataUrl: snap.dataUrl, ratio: snap.width / snap.height };
  } finally {
    host.remove();
  }
}


async function drawTextImage(
  pdf: jsPDF,
  text: string,
  opts: { x: number; y: number; w: number; fontSize?: number; bold?: boolean; color?: string; italic?: boolean; bg?: string; align?: "left" | "right" | "center" },
): Promise<number> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${opts.w * 2}px;padding:0;background:${opts.bg ?? "transparent"};font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:${opts.color ?? "#0f172a"};font-size:${(opts.fontSize ?? 12) * 2}px;font-weight:${opts.bold ? 700 : 400};font-style:${opts.italic ? "italic" : "normal"};text-align:${opts.align ?? "left"};line-height:1.3;`;
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
}

// POI list block for PDF — 2 columns of 5 rows + bucket bars.
async function renderPoiListBlock(input: ExportInput): Promise<{ dataUrl: string; ratio: number } | null> {
  const d = input.analytics;
  if (!d || !d.ok) return null;
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-99999px;top:0;width:820px;padding:14px 18px;background:#fff;font-family:'Sarabun','Noto Sans Thai',system-ui,sans-serif;color:#0f172a;box-sizing:border-box;border:1px solid #DBE3EF;border-radius:6px;";

  const maxBucket = Math.max(...d.buckets.map((b) => b.count), 1);
  const bucketHtml = d.buckets.slice(0, 5).map((b) => {
    const pct = Math.max(6, Math.round((b.count / maxBucket) * 100));
    return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12px;">
      <span style="width:22px;">${b.icon}</span>
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(b.label)}</span>
      <span style="height:8px;width:120px;background:#e2e8f0;border-radius:8px;overflow:hidden;">
        <span style="display:block;height:8px;width:${pct}%;background:${b.color};"></span>
      </span>
      <b style="width:28px;text-align:right;">${b.count}</b>
    </div>`;
  }).join("");

  const pois = d.topPOIs.slice(0, 10);
  const col1 = pois.slice(0, 5);
  const col2 = pois.slice(5, 10);
  const rowHtml = (p: typeof pois[number], idx: number) =>
    `<div style="display:flex;gap:8px;font-size:11px;padding:3px 0;border-bottom:1px dashed #e2e8f0;">
      <span style="width:18px;color:#94A3B8;">${idx + 1}.</span>
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.name)}</span>
      <b style="width:52px;text-align:right;">${p.distanceM} ม.</b>
    </div>`;

  host.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
      <div style="font-size:14px;font-weight:700;color:#17365D;">POI รอบป้าย (${d.totalPOIs.toLocaleString()} แห่ง)</div>
      <div style="font-size:11px;color:#64748b;">รัศมี ${d.radiusM} ม.</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <div style="font-size:11px;font-weight:600;color:#64748b;margin-bottom:2px;">หมวด POI</div>
        ${bucketHtml || `<div style="font-size:11px;color:#94A3B8;">ไม่พบ</div>`}
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:#64748b;margin-bottom:2px;">ใกล้ที่สุด (Top 10)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px;">
          <div>${col1.map((p, i) => rowHtml(p, i)).join("") || "—"}</div>
          <div>${col2.map((p, i) => rowHtml(p, i + 5)).join("")}</div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(host);
  try {
    const snap = await snapshotNode(host);
    if (!snap) return null;
    return { dataUrl: snap.dataUrl, ratio: snap.width / snap.height };
  } finally {
    host.remove();
  }
}

export async function fetchImageAsDataUrl(url: string): Promise<string> {
  return await urlToDataUrl(url);
}
