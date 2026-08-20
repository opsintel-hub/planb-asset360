import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdRow = {
  id: string;
  asset_old_code: string | null;
  product_name: string | null;
  ad_contract: string | null;
  equipment_id: string | null;
  status: string | null;
  start_date_contract: string | null;
  end_date_contract: string | null;
  favor_start_date_contract: string | null;
  favor_end_date_contract: string | null;
};

export type AdAsset = {
  old_code: string;
  name: string | null;
  department: string | null;
  media_type: string | null;
  district: string | null;
  location: string | null;
  status: string | null;
  lat: number | null;
  lng: number | null;
};

function parseLatLng(raw: unknown): [number, number] | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

type AssetRow = {
  old_code: string | null;
  name: string | null;
  department: string | null;
  media_type: string | null;
  district: string | null;
  location: string | null;
  status: string | null;
  latitude: number | null;
  longitude: number | null;
  payload: Record<string, unknown> | null;
};

function toAdAsset(r: AssetRow): AdAsset {
  let lat = r.latitude != null ? Number(r.latitude) : null;
  let lng = r.longitude != null ? Number(r.longitude) : null;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    const ll = parseLatLng((r.payload ?? {})["LatitudeLongitude"]);
    if (ll) { lat = ll[0]; lng = ll[1]; }
  }
  const p = (r.payload ?? {}) as Record<string, unknown>;
  return {
    old_code: r.old_code ?? "",
    name: r.name ?? (typeof p.Description === "string" ? p.Description : null),
    department: r.department,
    media_type: r.media_type ?? (typeof p.MediaType === "string" ? p.MediaType : null),
    district: r.district,
    location: r.location ?? (typeof p.Location === "string" ? p.Location : null),
    status: r.status,
    lat: lat ?? null,
    lng: lng ?? null,
  };
}

const ASSET_COLS = "old_code, name, department, media_type, district, location, status, latitude, longitude, payload";

/** Admin: run the CRM sync immediately (direct MySQL pull). */
export const syncAdContractsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: role } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("ต้องมีสิทธิ์ผู้ดูแลระบบ (admin)");
    const { pullAdContractsFromCrm } = await import("@/lib/ad-contracts.server");
    return pullAdContractsFromCrm();
  });

/** Summary counters used on the dashboard + campaigns page. */
export const getAdSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

    const [{ count: totalAssets }, { count: currentRows }, { count: expiring }, { data: distinctRows }] =
      await Promise.all([
        context.supabase.from("assets").select("old_code", { count: "exact", head: true }),
        context.supabase.from("ad_contracts").select("id", { count: "exact", head: true }).eq("status", "current"),
        context.supabase
          .from("ad_contracts")
          .select("id", { count: "exact", head: true })
          .eq("status", "current")
          .gte("end_date_contract", today)
          .lte("end_date_contract", in30),
        context.supabase.from("ad_current_by_asset").select("asset_old_code, product_name").limit(20000),
      ]);

    const occupied = new Set<string>();
    const products = new Set<string>();
    for (const r of (distinctRows ?? []) as Array<{ asset_old_code: string | null; product_name: string | null }>) {
      if (r.asset_old_code) occupied.add(r.asset_old_code);
      if (r.product_name) products.add(r.product_name);
    }

    return {
      totalAssets: totalAssets ?? 0,
      currentContracts: currentRows ?? 0,
      expiring30: expiring ?? 0,
      occupiedAssets: occupied.size,
      vacantAssets: Math.max(0, (totalAssets ?? 0) - occupied.size),
      activeProducts: products.size,
      lastSyncedAt: null as string | null,
    };
  });

/** Distinct ad names with how many assets they run on (search / autocomplete). */
export const listAdProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        q: z.string().max(200).optional(),
        scope: z.enum(["current", "all"]).optional(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("ad_contracts")
      .select("product_name, asset_old_code, status, start_date_contract, end_date_contract")
      .not("product_name", "is", null)
      .limit(20000);
    if ((data.scope ?? "current") === "current") query = query.eq("status", "current");
    if (data.q && data.q.trim()) query = query.ilike("product_name", `%${data.q.trim()}%`);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const map = new Map<string, { product: string; assets: Set<string>; start: string | null; end: string | null }>();
    for (const r of (rows ?? []) as Array<{
      product_name: string | null;
      asset_old_code: string | null;
      start_date_contract: string | null;
      end_date_contract: string | null;
    }>) {
      const key = r.product_name ?? "";
      if (!key) continue;
      const cur = map.get(key) ?? { product: key, assets: new Set<string>(), start: null, end: null };
      if (r.asset_old_code) cur.assets.add(r.asset_old_code);
      if (r.start_date_contract && (!cur.start || r.start_date_contract < cur.start)) cur.start = r.start_date_contract;
      if (r.end_date_contract && (!cur.end || r.end_date_contract > cur.end)) cur.end = r.end_date_contract;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map((v) => ({ product: v.product, assetCount: v.assets.size, firstStart: v.start, lastEnd: v.end }))
      .sort((a, b) => b.assetCount - a.assetCount || a.product.localeCompare(b.product));
  });

/** All assets a given ad name runs (or ran) on, with coordinates for the map. */
export const getAdPlacements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        product: z.string().min(1).max(300),
        scope: z.enum(["current", "history", "all"]).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("ad_contracts")
      .select(
        "id, asset_old_code, product_name, ad_contract, equipment_id, status, start_date_contract, end_date_contract, favor_start_date_contract, favor_end_date_contract",
      )
      .eq("product_name", data.product)
      .limit(5000);
    const scope = data.scope ?? "current";
    if (scope === "current") q = q.eq("status", "current");
    if (scope === "history") q = q.neq("status", "current");
    const { data: contracts, error } = await q;
    if (error) throw new Error(error.message);

    const codes = Array.from(
      new Set(((contracts ?? []) as AdRow[]).map((c) => c.asset_old_code).filter(Boolean) as string[]),
    );
    const assets: AdAsset[] = [];
    const chunk = 300;
    for (let i = 0; i < codes.length; i += chunk) {
      const { data: rows } = await context.supabase
        .from("assets")
        .select(ASSET_COLS)
        .in("old_code", codes.slice(i, i + chunk));
      for (const r of (rows ?? []) as AssetRow[]) assets.push(toAdAsset(r));
    }
    return { contracts: (contracts ?? []) as AdRow[], assets };
  });

/** Full ad history for one asset (timeline on the Asset History page). */
export const getAssetAdHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ oldCode: z.string().min(1).max(120) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("ad_contracts")
      .select(
        "id, asset_old_code, product_name, ad_contract, equipment_id, status, start_date_contract, end_date_contract, favor_start_date_contract, favor_end_date_contract",
      )
      .eq("asset_old_code", data.oldCode)
      .order("start_date_contract", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as AdRow[];
    const today = new Date().toISOString().slice(0, 10);
    const current =
      list.find(
        (r) =>
          r.status === "current" &&
          (!r.end_date_contract || r.end_date_contract >= today) &&
          (!r.start_date_contract || r.start_date_contract <= today),
      ) ?? list.find((r) => r.status === "current") ?? null;
    return { current, history: list };
  });

/** Current ad per asset code — used to enrich lists in other menus. */
export const getCurrentAdsByCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ codes: z.array(z.string().max(120)).max(3000) }).parse(i))
  .handler(async ({ data, context }) => {
    const codes = Array.from(new Set(data.codes.filter(Boolean)));
    const out: Record<string, { product_name: string | null; end_date_contract: string | null; days_to_end: number | null }> = {};
    const chunk = 300;
    for (let i = 0; i < codes.length; i += chunk) {
      const { data: rows } = await context.supabase
        .from("ad_current_by_asset")
        .select("asset_old_code, product_name, end_date_contract, days_to_end")
        .in("asset_old_code", codes.slice(i, i + chunk));
      for (const r of (rows ?? []) as Array<{
        asset_old_code: string | null;
        product_name: string | null;
        end_date_contract: string | null;
        days_to_end: number | null;
      }>) {
        if (r.asset_old_code)
          out[r.asset_old_code] = {
            product_name: r.product_name,
            end_date_contract: r.end_date_contract,
            days_to_end: r.days_to_end,
          };
      }
    }
    return out;
  });

/** Which ads ran in a period (e.g. Jan–Jun 2026) and on which assets. */
export const getAdsInPeriod = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // overlap test: start <= to AND (end is null OR end >= from)
    const { data: rows, error } = await context.supabase
      .from("ad_contracts")
      .select(
        "id, asset_old_code, product_name, ad_contract, equipment_id, status, start_date_contract, end_date_contract, favor_start_date_contract, favor_end_date_contract",
      )
      .lte("start_date_contract", data.to)
      .or(`end_date_contract.is.null,end_date_contract.gte.${data.from}`)
      .limit(20000);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as AdRow[];
    const byProduct = new Map<string, { product: string; assets: Set<string>; rows: AdRow[] }>();
    for (const r of list) {
      const key = r.product_name ?? "(ไม่ระบุชื่อโฆษณา)";
      const cur = byProduct.get(key) ?? { product: key, assets: new Set<string>(), rows: [] };
      if (r.asset_old_code) cur.assets.add(r.asset_old_code);
      cur.rows.push(r);
      byProduct.set(key, cur);
    }
    return {
      total: list.length,
      products: Array.from(byProduct.values())
        .map((v) => ({ product: v.product, assetCount: v.assets.size, rows: v.rows }))
        .sort((a, b) => b.assetCount - a.assetCount),
    };
  });

/** Assets with no current ad — the sales prospect list. */
export const getVacantAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        department: z.string().max(120).optional(),
        mediaType: z.string().max(120).optional(),
        district: z.string().max(120).optional(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: occupiedRows } = await context.supabase
      .from("ad_current_by_asset")
      .select("asset_old_code")
      .limit(20000);
    const occupied = new Set(
      ((occupiedRows ?? []) as Array<{ asset_old_code: string | null }>)
        .map((r) => r.asset_old_code)
        .filter(Boolean) as string[],
    );

    const rows: AssetRow[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let q = context.supabase.from("assets").select(ASSET_COLS).range(from, from + pageSize - 1);
      if (data.department) q = q.eq("department", data.department);
      if (data.mediaType) q = q.eq("media_type", data.mediaType);
      if (data.district) q = q.eq("district", data.district);
      const { data: page, error } = await q;
      if (error) throw new Error(error.message);
      if (!page || page.length === 0) break;
      rows.push(...(page as AssetRow[]));
      if (page.length < pageSize) break;
    }

    const vacant = rows.filter((r) => !r.old_code || !occupied.has(r.old_code)).map(toAdAsset);
    const departments = Array.from(new Set(rows.map((r) => r.department).filter(Boolean) as string[])).sort();
    const mediaTypes = Array.from(new Set(rows.map((r) => r.media_type).filter(Boolean) as string[])).sort();
    const districts = Array.from(new Set(rows.map((r) => r.district).filter(Boolean) as string[])).sort();
    return { vacant, totalAssets: rows.length, departments, mediaTypes, districts };
  });

/** Whole-table map of the CURRENT ad per asset code — used to colour the Asset Map. */
export const getAllCurrentAds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const out: Record<string, { product: string | null; end: string | null; daysToEnd: number | null }> = {};
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await context.supabase
        .from("ad_current_by_asset")
        .select("asset_old_code, product_name, end_date_contract, days_to_end")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const r of data as Array<{
        asset_old_code: string | null;
        product_name: string | null;
        end_date_contract: string | null;
        days_to_end: number | null;
      }>) {
        if (r.asset_old_code)
          out[r.asset_old_code] = {
            product: r.product_name,
            end: r.end_date_contract,
            daysToEnd: r.days_to_end,
          };
      }
      if (data.length < pageSize) break;
    }
    return out;
  });
