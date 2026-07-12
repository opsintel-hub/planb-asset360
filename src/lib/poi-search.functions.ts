import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  fetchOverpass,
  buildOverpassQuery,
  classifyPreset,
  haversineMeters,
  type Bbox,
  type OverpassResponse,
} from "./overpass";

export type POI = {
  id: string;
  name: string;
  presetKey: string;
  lat: number;
  lng: number;
  tags: Record<string, string>;
};

export type POIMatch = {
  assetId: string;
  poiId: string;
  distanceM: number;
};

export type POISearchInput = {
  presetKeys: string[];
  freeText?: string | null;
  bbox: Bbox;
  radiusM: number;
  matchMode?: "any" | "all";
};

export type POISearchResult = {
  ok: boolean;
  error?: string;
  pois: POI[];
  matches: POIMatch[];
  assetCount: number;
  poiCount: number;
  matchedAssetCount: number;
};

export const searchPOIsNearAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: POISearchInput) => {
    if (!input || typeof input !== "object") throw new Error("invalid input");
    if (!Array.isArray(input.bbox) || input.bbox.length !== 4) throw new Error("invalid bbox");
    if (!Array.isArray(input.presetKeys)) throw new Error("invalid presetKeys");
    const r = Number(input.radiusM);
    if (!Number.isFinite(r) || r <= 0 || r > 5000) throw new Error("invalid radiusM");
    return input;
  })
  .handler(async ({ data, context }): Promise<POISearchResult> => {
    const presetKeys = data.presetKeys.filter((k) => typeof k === "string");
    const freeText = (data.freeText ?? "").trim();
    if (presetKeys.length === 0 && !freeText) {
      return { ok: false, error: "เลือกประเภทสถานที่ หรือพิมพ์คำค้นหาอย่างน้อย 1 อย่าง", pois: [], matches: [], assetCount: 0, poiCount: 0, matchedAssetCount: 0 };
    }

    const query = buildOverpassQuery(presetKeys, freeText || null, data.bbox);
    if (!query) {
      return { ok: false, error: "สร้างคิวรี Overpass ไม่ได้", pois: [], matches: [], assetCount: 0, poiCount: 0, matchedAssetCount: 0 };
    }

    // Call Overpass
    let raw: OverpassResponse;
    try {
      const resp = await fetch(OVERPASS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        return { ok: false, error: `Overpass ${resp.status}: ${t.slice(0, 120)}`, pois: [], matches: [], assetCount: 0, poiCount: 0, matchedAssetCount: 0 };
      }
      raw = (await resp.json()) as OverpassResponse;
    } catch (e) {
      return { ok: false, error: `Overpass ล้มเหลว: ${(e as Error).message}`, pois: [], matches: [], assetCount: 0, poiCount: 0, matchedAssetCount: 0 };
    }

    // Parse elements -> POIs
    const pois: POI[] = [];
    for (const el of raw.elements ?? []) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      const tags = el.tags ?? {};
      const name = tags.name || tags["name:th"] || tags["name:en"] || tags.brand || "(ไม่มีชื่อ)";
      pois.push({
        id: `${el.type[0]}${el.id}`,
        name,
        presetKey: classifyPreset(tags),
        lat, lng: lon,
        tags,
      });
    }

    // Load assets within bbox from DB
    const [s, w, n, e] = data.bbox;
    const rows: Array<{
      id: string; latitude: number | null; longitude: number | null;
    }> = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data: rowsPage, error } = await context.supabase
        .from("assets")
        .select("id, latitude, longitude")
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .gte("latitude", s).lte("latitude", n)
        .gte("longitude", w).lte("longitude", e)
        .range(from, from + pageSize - 1);
      if (error) return { ok: false, error: error.message, pois, matches: [], assetCount: 0, poiCount: pois.length, matchedAssetCount: 0 };
      if (!rowsPage || rowsPage.length === 0) break;
      rows.push(...(rowsPage as typeof rows));
      if (rowsPage.length < pageSize) break;
      from += pageSize;
    }

    // Compute matches
    const matches: POIMatch[] = [];
    const perAssetPresets = new Map<string, Set<string>>();
    for (const a of rows) {
      if (a.latitude == null || a.longitude == null) continue;
      for (const p of pois) {
        const d = haversineMeters(a.latitude, a.longitude, p.lat, p.lng);
        if (d <= data.radiusM) {
          matches.push({ assetId: a.id, poiId: p.id, distanceM: d });
          let s = perAssetPresets.get(a.id);
          if (!s) { s = new Set(); perAssetPresets.set(a.id, s); }
          s.add(p.presetKey);
        }
      }
    }

    // Filter by matchMode
    let matchedAssetIds: Set<string>;
    if (data.matchMode === "all" && presetKeys.length > 0) {
      matchedAssetIds = new Set();
      for (const [aid, presets] of perAssetPresets) {
        if (presetKeys.every((k) => presets.has(k))) matchedAssetIds.add(aid);
      }
    } else {
      matchedAssetIds = new Set(perAssetPresets.keys());
    }

    const filteredMatches = matches.filter((m) => matchedAssetIds.has(m.assetId));

    return {
      ok: true,
      pois,
      matches: filteredMatches,
      assetCount: rows.length,
      poiCount: pois.length,
      matchedAssetCount: matchedAssetIds.size,
    };
  });
