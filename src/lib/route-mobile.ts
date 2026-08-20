// Phase C — hand a day plan to the technician's phone.
// Pure string building: Google Maps deep links, plain-text plan, share sheet.
// No AI, no paid API.

import type { PlanPoint } from "./route-planner";

export type MobileDay = {
  inspectorLabel: string;
  day: number;
  points: PlanPoint[];
  start?: { lat: number; lng: number; name?: string } | null;
  end?: { lat: number; lng: number; name?: string } | null;
};

const ll = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/**
 * Google Maps directions supports at most 10 points per URL (origin +
 * 8 waypoints + destination), so a long day becomes several sequential links
 * where each one starts where the previous ended.
 */
export function googleMapsLinks(day: MobileDay, travelmode: "driving" | "two-wheeler" = "driving"): string[] {
  const pts = day.points;
  if (pts.length === 0) return [];
  const chain: Array<{ lat: number; lng: number }> = [];
  if (day.start) chain.push(day.start);
  chain.push(...pts.map((p) => ({ lat: p.lat, lng: p.lng })));
  if (day.end) chain.push(day.end);

  const links: string[] = [];
  let i = 0;
  while (i < chain.length - 1) {
    const seg = chain.slice(i, i + 10);
    if (seg.length < 2) break;
    const origin = seg[0];
    const destination = seg[seg.length - 1];
    const waypoints = seg.slice(1, -1);
    const params = new URLSearchParams({
      api: "1",
      origin: ll(origin),
      destination: ll(destination),
      travelmode,
    });
    if (waypoints.length) params.set("waypoints", waypoints.map(ll).join("|"));
    links.push(`https://www.google.com/maps/dir/?${params.toString()}`);
    i += seg.length - 1;
  }
  return links;
}

/** Text briefing a technician can read straight from LINE / WhatsApp. */
export function planTextForDay(day: MobileDay, links: string[] = []): string {
  const head = `แผนตรวจป้าย · ${day.inspectorLabel} · วันที่ ${day.day}`;
  const startLine = day.start ? `จุดเริ่ม: ${day.start.name ?? ll(day.start)}` : "";
  const list = day.points
    .map((p, i) => {
      const risk = p.risk === "high" ? " ⚠️ เสี่ยงสูง" : p.risk === "medium" ? " • เสี่ยงกลาง" : "";
      const name = p.name ? ` ${p.name}` : "";
      return `${i + 1}. ${p.code}${name}${risk}\n   https://maps.google.com/?q=${ll(p)}`;
    })
    .join("\n");
  const linkBlock = links.length
    ? `\n\nเส้นทางใน Google Maps:\n${links.map((u, i) => `ช่วงที่ ${i + 1}: ${u}`).join("\n")}`
    : "";
  return [head, startLine, `จำนวนป้าย: ${day.points.length}`, "", list].filter(Boolean).join("\n") + linkBlock;
}

/** Native share sheet on mobile, clipboard fallback on desktop. */
export async function shareOrCopy(text: string, title = "แผนตรวจป้าย"): Promise<"shared" | "copied"> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (typeof nav.share === "function") {
    try {
      await nav.share({ title, text });
      return "shared";
    } catch {
      // user cancelled or unsupported payload — fall through to clipboard
    }
  }
  await navigator.clipboard.writeText(text);
  return "copied";
}

/** LINE share URL (opens the LINE app on mobile, web share on desktop). */
export function lineShareUrl(text: string): string {
  return `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
}
