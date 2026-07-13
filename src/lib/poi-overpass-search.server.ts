import {
  buildOverpassQuery,
  fetchOverpassJson,
  type Bbox,
  type OverpassElement,
  type OverpassResponse,
} from "./overpass";

type AdaptiveOverpassResult = {
  raw: OverpassResponse;
  strategy: "single" | "tiled";
  warnings: string[];
};

const TILE_TARGET_SPAN_DEG = 0.18;
const MAX_TILES = 12;
const TILE_CONCURRENCY = 2;

function shouldUseTiledSearch(bbox: Bbox, presetCount: number, hasFreeText: boolean): boolean {
  const latSpan = Math.abs(bbox[2] - bbox[0]);
  const lngSpan = Math.abs(bbox[3] - bbox[1]);
  const areaDeg2 = latSpan * lngSpan;
  return areaDeg2 > 0.05 || latSpan > 0.25 || lngSpan > 0.25 || presetCount > 3 || hasFreeText;
}

function splitBbox(bbox: Bbox): Bbox[] {
  const [s, w, n, e] = bbox;
  const latSpan = Math.max(0.0001, n - s);
  const lngSpan = Math.max(0.0001, e - w);
  let rows = Math.max(1, Math.ceil(latSpan / TILE_TARGET_SPAN_DEG));
  let cols = Math.max(1, Math.ceil(lngSpan / TILE_TARGET_SPAN_DEG));

  if (rows * cols > MAX_TILES) {
    const scale = Math.sqrt(MAX_TILES / (rows * cols));
    rows = Math.max(1, Math.floor(rows * scale));
    cols = Math.max(1, Math.floor(cols * scale));
    while (rows * cols > MAX_TILES && rows >= cols && rows > 1) rows -= 1;
    while (rows * cols > MAX_TILES && cols > 1) cols -= 1;
  }

  const tiles: Bbox[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const ts = s + (latSpan * r) / rows;
      const tn = s + (latSpan * (r + 1)) / rows;
      const tw = w + (lngSpan * c) / cols;
      const te = w + (lngSpan * (c + 1)) / cols;
      tiles.push([ts, tw, tn, te]);
    }
  }
  return tiles;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function dedupeElements(groups: OverpassResponse[]): OverpassElement[] {
  const seen = new Set<string>();
  const out: OverpassElement[] = [];
  for (const group of groups) {
    for (const el of group.elements ?? []) {
      const key = `${el.type}:${el.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(el);
    }
  }
  return out;
}

async function fetchTiled(args: {
  presetKeys: string[];
  freeText: string | null;
  bbox: Bbox;
}): Promise<AdaptiveOverpassResult> {
  const tiles = splitBbox(args.bbox);
  const warnings: string[] = [];
  const responses = await mapWithConcurrency(tiles, TILE_CONCURRENCY, async (tile, index) => {
    const query = buildOverpassQuery(args.presetKeys, args.freeText, tile);
    if (!query) return null;
    try {
      return await fetchOverpassJson<OverpassResponse>(query);
    } catch (e) {
      warnings.push(`พื้นที่ย่อย ${index + 1}/${tiles.length}: ${(e as Error).message}`);
      return null;
    }
  });

  const successful = responses.filter((r): r is OverpassResponse => !!r && Array.isArray(r.elements));
  if (successful.length === 0) {
    throw new Error(warnings[0] ?? "Overpass timeout");
  }

  return {
    raw: { elements: dedupeElements(successful) },
    strategy: "tiled",
    warnings: warnings.length > 0 ? [`ค้นหาได้บางพื้นที่ (${successful.length}/${tiles.length})`] : [],
  };
}

export async function fetchPoisFromOverpassAdaptive(args: {
  presetKeys: string[];
  freeText: string | null;
  bbox: Bbox;
}): Promise<AdaptiveOverpassResult> {
  const query = buildOverpassQuery(args.presetKeys, args.freeText, args.bbox);
  if (!query) throw new Error("สร้างคิวรี Overpass ไม่ได้");

  if (shouldUseTiledSearch(args.bbox, args.presetKeys.length, !!args.freeText)) {
    return fetchTiled(args);
  }

  try {
    return {
      raw: await fetchOverpassJson<OverpassResponse>(query),
      strategy: "single",
      warnings: [],
    };
  } catch (e) {
    const fallback = await fetchTiled(args);
    return {
      ...fallback,
      warnings: [`Overpass ตอบช้า จึงแบ่งพื้นที่ค้นหาอัตโนมัติ`, ...fallback.warnings],
    };
  }
}