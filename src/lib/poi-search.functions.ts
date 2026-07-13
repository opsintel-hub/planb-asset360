import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  fetchOverpassJson,
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
  bkkupc?: string | null;                // "BKK" | "UPC" | null (any)
  districts?: string[] | null;
  territories?: string[] | null;
  locations?: string[] | null;
  departments?: string[] | null;
  mediaTypes?: string[] | null;
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
  bkkupcs: Array<{ value: string; count: number }>;
  districts: Array<{ value: string; count: number }>;
  territories: Array<{ value: string; count: number }>;
  departments: Array<{ value: string; count: number }>;
  mediaTypes: Array<{ value: string; count: number }>;
};

/**
 * Fast filter-option loader — reads real columns (indexed), pages the whole
 * assets table once. With b-tree indexes this is a single seq/index scan.
 */
export const getPOIFilterOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<POIFilterOptions> => {
    const bkkupcs = new Map<string, number>();
    const districts = new Map<string, number>();
    const territories = new Map<string, number>();
    const departments = new Map<string, number>();
    const mediaTypes = new Map<string, number>();
    const pageSize = 1000;
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await context.supabase
        .from("assets")
        .select("bkkupc, district, territory, department, media_type")
        .not("latitude", "is", null)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const row of data as Array<{
        bkkupc: string | null;
        district: string | null;
        territory: string | null;
        department: string | null;
        media_type: string | null;
      }>) {
        const b = row.bkkupc?.trim();
        const d = row.district?.trim();
        const t = row.territory?.trim();
        const dep = row.department?.trim();
        const m = row.media_type?.trim();
        if (b) bkkupcs.set(b, (bkkupcs.get(b) ?? 0) + 1);
        if (d) districts.set(d, (districts.get(d) ?? 0) + 1);
        if (t) territories.set(t, (territories.get(t) ?? 0) + 1);
        if (dep) departments.set(dep, (departments.get(dep) ?? 0) + 1);
        if (m) mediaTypes.set(m, (mediaTypes.get(m) ?? 0) + 1);
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }
    const toSorted = (m: Map<string, number>) =>
      Array.from(m, ([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
    return {
      bkkupcs: toSorted(bkkupcs),
      districts: toSorted(districts),
      territories: toSorted(territories),
      departments: toSorted(departments),
      mediaTypes: toSorted(mediaTypes),
    };
  });

/**
 * Trigram-indexed typeahead for Location — only fetch matches for what the
 * user is typing. Returns top 50 by frequency.
 */
export const searchLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { q: string }) => ({ q: String(input?.q ?? "").trim() }))
  .handler(async ({ data, context }): Promise<Array<{ value: string; count: number }>> => {
    if (!data.q || data.q.length < 2) return [];
    const { data: rows, error } = await context.supabase
      .from("assets")
      .select("location")
      .ilike("location", `%${data.q}%`)
      .not("location", "is", null)
      .limit(500);
    if (error) throw new Error(error.message);
    const counts = new Map<string, number>();
    for (const r of (rows ?? []) as Array<{ location: string | null }>) {
      const v = r.location?.trim();
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return Array.from(counts, ([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
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

    // ---- Step 1: fetch assets FIRST, with column-based (indexed) filters ----
    const [s, w, n, e] = data.bbox;
    const bkkupc = (data.bkkupc ?? "").trim();
    const districts = (data.districts ?? []).filter((x): x is string => typeof x === "string" && !!x);
    const territories = (data.territories ?? []).filter((x): x is string => typeof x === "string" && !!x);
    const locations = (data.locations ?? []).filter((x): x is string => typeof x === "string" && !!x);
    const departments = (data.departments ?? []).filter((x): x is string => typeof x === "string" && !!x);
    const mediaTypes = (data.mediaTypes ?? []).filter((x): x is string => typeof x === "string" && !!x);

    const rows: Array<{ id: string; latitude: number | null; longitude: number | null }> = [];
    const pageSize = 1000;
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q = context.supabase
        .from("assets")
        .select("id, latitude, longitude")
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .gte("latitude", s).lte("latitude", n)
        .gte("longitude", w).lte("longitude", e);
      if (bkkupc) q = q.eq("bkkupc", bkkupc);
      if (districts.length > 0) q = q.in("district", districts);
      if (territories.length > 0) q = q.in("territory", territories);
      if (locations.length > 0) q = q.in("location", locations);
      if (departments.length > 0) q = q.in("department", departments);
      if (mediaTypes.length > 0) q = q.in("media_type", mediaTypes);
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

    // Guard: if the tightened bbox is still very large, Overpass will time out.
    // Ask the user to add a filter or zoom in instead of hanging for 60+ seconds.
    const latSpan = tightBbox[2] - tightBbox[0];
    const lngSpan = tightBbox[3] - tightBbox[1];
    const areaDeg2 = latSpan * lngSpan;
    const hasGeoFilter =
      !!bkkupc || districts.length > 0 || territories.length > 0
      || locations.length > 0 || departments.length > 0 || mediaTypes.length > 0;
    if (areaDeg2 > 4 || latSpan > 3 || lngSpan > 3) {
      return {
        ok: false,
        error: hasGeoFilter
          ? `พื้นที่ค้นหากว้างเกินไป (~${(latSpan * 111).toFixed(0)}×${(lngSpan * 111).toFixed(0)} กม.) — Overpass จะ timeout กรุณาซูมแผนที่เข้าอีก หรือเพิ่มตัวกรอง เขต/พื้นที่/จุดติดตั้ง`
          : `พื้นที่ค้นหากว้างเกินไป (~${(latSpan * 111).toFixed(0)}×${(lngSpan * 111).toFixed(0)} กม.) — กรุณาเลือกตัวกรอง (BKKUPC / เขต / พื้นที่) หรือซูมแผนที่ก่อน`,
        pois: [], matches: [], assetCount: rows.length, poiCount: 0, matchedAssetCount: 0,
      };
    }

    // ---- Step 3: Overpass on tightened bbox ----
    const query = buildOverpassQuery(presetKeys, freeText || null, tightBbox);
    if (!query) {
      return { ok: false, error: "สร้างคิวรี Overpass ไม่ได้", pois: [], matches: [], assetCount: rows.length, poiCount: 0, matchedAssetCount: 0 };
    }

    let raw: OverpassResponse;
    try {
      raw = await fetchOverpassJson<OverpassResponse>(query);
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
