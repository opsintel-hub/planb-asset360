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
  territories?: string[] | null;
  regions?: string[] | null;
};

export type POISearchResult = {
  ok: boolean;
  error?: string;
  pois: POI[];
  matches: POIMatch[];
  assetCount: number;
  poiCount: number;
  matchedAssetCount: number;
  usedBbox?: Bbox;
  elapsedMs?: number;
};

export type POIFilterOptions = {
  territories: Array<{ value: string; count: number }>;
  regions: Array<{ value: string; count: number }>;
};

export const getPOIFilterOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<POIFilterOptions> => {
    // Pull a large-enough sample of assets and aggregate client-side.
    // (assets ≈ 8k rows — cheap.)
    const territories = new Map<string, number>();
    const regions = new Map<string, number>();
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await context.supabase
        .from("assets")
        .select("payload")
        .not("latitude", "is", null)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const row of data as Array<{ payload: Record<string, unknown> | null }>) {
        const p = row.payload;
        if (!p) continue;
        const t = (p["Territory"] as string | undefined)?.trim();
        const r = (p["Region"] as string | undefined)?.trim();
        if (t) territories.set(t, (territories.get(t) ?? 0) + 1);
        if (r) regions.set(r, (regions.get(r) ?? 0) + 1);
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }
    const toSorted = (m: Map<string, number>) =>
      Array.from(m, ([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
    return { territories: toSorted(territories), regions: toSorted(regions) };
  });

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
    const t0 = Date.now();
    const presetKeys = data.presetKeys.filter((k) => typeof k === "string");
    const freeText = (data.freeText ?? "").trim();
    if (presetKeys.length === 0 && !freeText) {
      return { ok: false, error: "เลือกประเภทสถานที่ หรือพิมพ์คำค้นหาอย่างน้อย 1 อย่าง", pois: [], matches: [], assetCount: 0, poiCount: 0, matchedAssetCount: 0 };
    }

    // ---- Step 1: fetch assets FIRST (with optional territory/region filter) ----
    const [s, w, n, e] = data.bbox;
    const territories = (data.territories ?? []).filter((x) => typeof x === "string" && x);
    const regions = (data.regions ?? []).filter((x) => typeof x === "string" && x);

    const rows: Array<{ id: string; latitude: number | null; longitude: number | null }> = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      let q = context.supabase
        .from("assets")
        .select("id, latitude, longitude")
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .gte("latitude", s).lte("latitude", n)
        .gte("longitude", w).lte("longitude", e);
      if (territories.length > 0) q = q.in("payload->>Territory", territories);
      if (regions.length > 0) q = q.in("payload->>Region", regions);
      const { data: rowsPage, error } = await q.range(from, from + pageSize - 1);
      if (error) return { ok: false, error: error.message, pois: [], matches: [], assetCount: 0, poiCount: 0, matchedAssetCount: 0 };
      if (!rowsPage || rowsPage.length === 0) break;
      rows.push(...(rowsPage as typeof rows));
      if (rowsPage.length < pageSize) break;
      from += pageSize;
    }

    if (rows.length === 0) {
      return {
        ok: true, pois: [], matches: [], assetCount: 0, poiCount: 0, matchedAssetCount: 0,
        elapsedMs: Date.now() - t0,
      };
    }

    // ---- Step 2: tighten bbox to asset extent + radius padding ----
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const a of rows) {
      if (a.latitude == null || a.longitude == null) continue;
      if (a.latitude < minLat) minLat = a.latitude;
      if (a.latitude > maxLat) maxLat = a.latitude;
      if (a.longitude < minLng) minLng = a.longitude;
      if (a.longitude > maxLng) maxLng = a.longitude;
    }
    const padLat = data.radiusM / 111000;
    const padLng = data.radiusM / (111000 * Math.cos((minLat + maxLat) / 2 * Math.PI / 180) || 1);
    const tightBbox: Bbox = [
      Math.max(s, minLat - padLat),
      Math.max(w, minLng - padLng),
      Math.min(n, maxLat + padLat),
      Math.min(e, maxLng + padLng),
    ];

    // ---- Step 3: Overpass on tightened bbox ----
    const query = buildOverpassQuery(presetKeys, freeText || null, tightBbox);
    if (!query) {
      return { ok: false, error: "สร้างคิวรี Overpass ไม่ได้", pois: [], matches: [], assetCount: rows.length, poiCount: 0, matchedAssetCount: 0 };
    }

    let raw: OverpassResponse;
    try {
      const resp = await fetchOverpass(query);
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        return { ok: false, error: `Overpass ${resp.status}: ${t.slice(0, 120)}`, pois: [], matches: [], assetCount: rows.length, poiCount: 0, matchedAssetCount: 0 };
      }
      raw = (await resp.json()) as OverpassResponse;
    } catch (e) {
      return { ok: false, error: `Overpass ล้มเหลว: ${(e as Error).message}`, pois: [], matches: [], assetCount: rows.length, poiCount: 0, matchedAssetCount: 0 };
    }

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

    // ---- Step 4: match ----
    const matches: POIMatch[] = [];
    const perAssetPresets = new Map<string, Set<string>>();
    for (const a of rows) {
      if (a.latitude == null || a.longitude == null) continue;
      for (const p of pois) {
        const d = haversineMeters(a.latitude, a.longitude, p.lat, p.lng);
        if (d <= data.radiusM) {
          matches.push({ assetId: a.id, poiId: p.id, distanceM: d });
          let set = perAssetPresets.get(a.id);
          if (!set) { set = new Set(); perAssetPresets.set(a.id, set); }
          set.add(p.presetKey);
        }
      }
    }

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
      usedBbox: tightBbox,
      elapsedMs: Date.now() - t0,
    };
  });
