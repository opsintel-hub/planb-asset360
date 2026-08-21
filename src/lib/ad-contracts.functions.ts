import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchAllPaged } from "@/lib/ad-paging";
import { buildAssetCodeIndex, normalizeAssetCode } from "@/lib/asset-code";


export type AdRow = {
  id: string;
  asset_old_code: string | null;
  product_name: string | null;
  brand: string | null;
  brand_eng: string | null;
  package_name: string | null;
  package_code: string | null;
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

    const [{ count: totalAssets }, { count: currentRows }, { count: expiring }, distinctRows] = await Promise.all([
      context.supabase.from("assets").select("old_code", { count: "exact", head: true }),
      context.supabase.from("ad_contracts").select("id", { count: "exact", head: true }).eq("status", "current"),
      context.supabase
        .from("ad_contracts")
        .select("id", { count: "exact", head: true })
        .eq("status", "current")
        .gte("end_date_contract", today)
        .lte("end_date_contract", in30),
      fetchAllPaged<{ asset_old_code: string | null; ad_contract: string | null; brand: string | null }>((from, to) =>
        context.supabase
          .from("ad_contracts")
          .select("asset_old_code, ad_contract, brand")
          .eq("status", "current")
          .range(from, to),
      ),
    ]);

    // CRM holds codes that do not exist in our asset table, so only count
    // matched codes as "occupied". Match on the normalized code so spelling
    // differences ("MTP-A23" vs "MTP A23") still resolve to the same asset.
    const assetIndex = buildAssetCodeIndex(
      (
        await fetchAllPaged<{ old_code: string | null }>((from, to) =>
          context.supabase.from("assets").select("old_code").range(from, to),
        )
      ).map((r) => r.old_code),
    );

    const occupied = new Set<string>();
    const products = new Set<string>();
    const brands = new Set<string>();
    let unmatched = 0;
    for (const r of distinctRows) {
      if (r.asset_old_code) {
        const canonical = assetIndex.get(normalizeAssetCode(r.asset_old_code));
        if (canonical) occupied.add(canonical);
        else unmatched += 1;
      }
      if (r.ad_contract) products.add(r.ad_contract);
      if (r.brand) brands.add(r.brand);
    }


    return {
      totalAssets: totalAssets ?? 0,
      currentContracts: currentRows ?? 0,
      expiring30: expiring ?? 0,
      occupiedAssets: occupied.size,
      vacantAssets: Math.max(0, (totalAssets ?? 0) - occupied.size),
      activeContracts: products.size,
      activeProducts: products.size,
      activeBrands: brands.size,
      crmUnmatchedAssets: unmatched,
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
        brand: z.string().max(200).optional(),
        scope: z.enum(["current", "all"]).optional(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const rows = await fetchAllPaged<{
      ad_contract: string | null;
      package_name: string | null;
      brand: string | null;
      brand_eng: string | null;
      asset_old_code: string | null;
      start_date_contract: string | null;
      end_date_contract: string | null;
    }>((from, to) => {
      let query = context.supabase
        .from("ad_contracts")
        .select("ad_contract, package_name, brand, brand_eng, asset_old_code, status, start_date_contract, end_date_contract")
        .not("ad_contract", "is", null)
        .range(from, to);
      if ((data.scope ?? "current") === "current") query = query.eq("status", "current");
      if (data.brand && data.brand.trim()) query = query.eq("brand", data.brand.trim());
      if (data.q && data.q.trim()) {
        const t = data.q.trim().replace(/[,()]/g, " ");
        query = query.or(
          `ad_contract.ilike.%${t}%,package_name.ilike.%${t}%,brand.ilike.%${t}%,brand_eng.ilike.%${t}%`,
        );
      }
      return query;
    });

    const map = new Map<
      string,
      {
        product: string;
        brand: string | null;
        brandEng: string | null;
        packageName: string | null;
        assets: Set<string>;
        start: string | null;
        end: string | null;
      }
    >();
    for (const r of rows) {
      const key = r.ad_contract ?? "";
      if (!key) continue;
      const cur =
        map.get(key) ??
        { product: key, brand: null, brandEng: null, packageName: null, assets: new Set<string>(), start: null, end: null };
      if (!cur.packageName && r.package_name) cur.packageName = r.package_name;
      if (!cur.brand && r.brand) cur.brand = r.brand;
      if (!cur.brandEng && r.brand_eng) cur.brandEng = r.brand_eng;
      if (r.asset_old_code) cur.assets.add(r.asset_old_code);
      if (r.start_date_contract && (!cur.start || r.start_date_contract < cur.start)) cur.start = r.start_date_contract;
      if (r.end_date_contract && (!cur.end || r.end_date_contract > cur.end)) cur.end = r.end_date_contract;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map((v) => ({
        product: v.product,
        brand: v.brand,
        brandEng: v.brandEng,
        packageName: v.packageName,
        assetCount: v.assets.size,
        firstStart: v.start,
        lastEnd: v.end,
      }))
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
    const scope = data.scope ?? "current";
    const contracts = await fetchAllPaged<AdRow>((from, to) => {
      let q = context.supabase
        .from("ad_contracts")
        .select(
          "id, asset_old_code, product_name, brand, brand_eng, package_name, package_code, ad_contract, equipment_id, status, start_date_contract, end_date_contract, favor_start_date_contract, favor_end_date_contract",
        )
        .eq("ad_contract", data.product)
        .range(from, to);
      if (scope === "current") q = q.eq("status", "current");
      if (scope === "history") q = q.neq("status", "current");
      return q;
    });

    const codes = Array.from(new Set(contracts.map((c) => c.asset_old_code).filter(Boolean) as string[]));
    const assets: AdAsset[] = [];
    const chunk = 300;
    for (let i = 0; i < codes.length; i += chunk) {
      const { data: rows } = await context.supabase
        .from("assets")
        .select(ASSET_COLS)
        .in("old_code", codes.slice(i, i + chunk));
      for (const r of (rows ?? []) as AssetRow[]) assets.push(toAdAsset(r));
    }
    return { contracts, assets };
  });

/** Full ad history for one asset (timeline on the Asset History page). */
export const getAssetAdHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ oldCode: z.string().min(1).max(120) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("ad_contracts")
      .select(
        "id, asset_old_code, product_name, brand, brand_eng, package_name, package_code, ad_contract, equipment_id, status, start_date_contract, end_date_contract, favor_start_date_contract, favor_end_date_contract",
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
    const out: Record<
      string,
      {
        product_name: string | null;
        ad_contract: string | null;
        package_name: string | null;
        brand: string | null;
        brand_eng: string | null;
        end_date_contract: string | null;
        days_to_end: number | null;
      }
    > = {};
    const chunk = 300;
    for (let i = 0; i < codes.length; i += chunk) {
      const { data: rows } = await context.supabase
        .from("ad_current_by_asset")
        .select("asset_old_code, product_name, ad_contract, package_name, brand, brand_eng, end_date_contract, days_to_end")
        .in("asset_old_code", codes.slice(i, i + chunk));
      for (const r of (rows ?? []) as Array<{
        asset_old_code: string | null;
        product_name: string | null;
        ad_contract: string | null;
        package_name: string | null;
        brand: string | null;
        brand_eng: string | null;
        end_date_contract: string | null;
        days_to_end: number | null;
      }>) {
        if (r.asset_old_code)
          out[r.asset_old_code] = {
            product_name: r.product_name,
            ad_contract: r.ad_contract,
            package_name: r.package_name,
            brand: r.brand,
            brand_eng: r.brand_eng,
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
    const list = await fetchAllPaged<AdRow>((from, to) =>
      context.supabase
        .from("ad_contracts")
        .select(
          "id, asset_old_code, product_name, brand, brand_eng, package_name, package_code, ad_contract, equipment_id, status, start_date_contract, end_date_contract, favor_start_date_contract, favor_end_date_contract",
        )
        .lte("start_date_contract", data.to)
        .or(`end_date_contract.is.null,end_date_contract.gte.${data.from}`)
        .range(from, to),
    );
    const byProduct = new Map<string, { product: string; assets: Set<string>; rows: AdRow[] }>();
    for (const r of list) {
      const key = r.ad_contract ?? "(ไม่ระบุเลขสัญญา)";
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
    const occupiedRows = await fetchAllPaged<{ asset_old_code: string | null }>((from, to) =>
      context.supabase.from("ad_current_by_asset").select("asset_old_code").range(from, to),
    );
    const occupied = new Set(occupiedRows.map((r) => r.asset_old_code).filter(Boolean) as string[]);

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
    const out: Record<
      string,
      {
        product: string | null;
        contract: string | null;
        packageName: string | null;
        brand: string | null;
        brandEng: string | null;
        end: string | null;
        daysToEnd: number | null;
      }
    > = {};
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await context.supabase
        .from("ad_current_by_asset")
        .select("asset_old_code, product_name, ad_contract, package_name, brand, brand_eng, end_date_contract, days_to_end")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const r of data as Array<{
        asset_old_code: string | null;
        product_name: string | null;
        ad_contract: string | null;
        package_name: string | null;
        brand: string | null;
        brand_eng: string | null;
        end_date_contract: string | null;
        days_to_end: number | null;
      }>) {
        if (r.asset_old_code)
          out[r.asset_old_code] = {
            product: r.product_name,
            contract: r.ad_contract,
            packageName: r.package_name,
            brand: r.brand,
            brandEng: r.brand_eng,
            end: r.end_date_contract,
            daysToEnd: r.days_to_end,
          };
      }
      if (data.length < pageSize) break;
    }
    return out;
  });

/** Distinct brands (Thai + English) for the brand filter dropdowns. */
export const listAdBrands = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ scope: z.enum(["current", "all"]).optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const rows = await fetchAllPaged<{
      brand: string | null;
      brand_eng: string | null;
      asset_old_code: string | null;
      ad_contract: string | null;
    }>((from, to) => {
      let q = context.supabase
        .from("ad_contracts")
        .select("brand, brand_eng, asset_old_code, ad_contract")
        .not("brand", "is", null)
        .range(from, to);
      if ((data.scope ?? "current") === "current") q = q.eq("status", "current");
      return q;
    });

    const map = new Map<string, { brand: string; brandEng: string | null; assets: Set<string>; products: Set<string> }>();
    for (const r of rows) {
      const key = r.brand?.trim();
      if (!key) continue;
      const cur = map.get(key) ?? { brand: key, brandEng: null, assets: new Set<string>(), products: new Set<string>() };
      if (!cur.brandEng && r.brand_eng) cur.brandEng = r.brand_eng;
      if (r.asset_old_code) cur.assets.add(r.asset_old_code);
      if (r.ad_contract) cur.products.add(r.ad_contract);
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map((v) => ({ brand: v.brand, brandEng: v.brandEng, assetCount: v.assets.size, adCount: v.products.size }))
      .sort((a, b) => b.assetCount - a.assetCount || a.brand.localeCompare(b.brand, "th"));
  });

// ---------------------------------------------------------------------------
// Newly launched ads (photo team queue)
// "ขึ้นใหม่" = favor_start_date_contract (วันติดตั้งจริง) อยู่ในช่วง N วันล่าสุด
// ---------------------------------------------------------------------------

export type NewAdRow = {
  id: string;
  asset_old_code: string | null;
  brand: string | null;
  brand_eng: string | null;
  ad_contract: string | null;
  product_name: string | null;
  package_name: string | null;
  favor_start: string | null;
  end_date_contract: string | null;
  days_since_launch: number | null;
  asset: AdAsset | null;
};

function windowStart(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

/** Rows whose real install date (favor_start) falls in the last N days. */
export const listNewlyLaunchedAds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        days: z.number().int().min(1).max(120).optional(),
        brand: z.string().max(200).optional(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const days = data.days ?? 7;
    const from = windowStart(days);
    const today = new Date().toISOString().slice(0, 10);

    const rows = await fetchAllPaged<AdRow>((a, b) => {
      let q = context.supabase
        .from("ad_contracts")
        .select(
          "id, asset_old_code, product_name, brand, brand_eng, package_name, package_code, ad_contract, equipment_id, status, start_date_contract, end_date_contract, favor_start_date_contract, favor_end_date_contract",
        )
        .not("favor_start_date_contract", "is", null)
        .gte("favor_start_date_contract", from)
        .lte("favor_start_date_contract", today)
        .range(a, b);
      if (data.brand && data.brand.trim()) q = q.eq("brand", data.brand.trim());
      return q;
    });

    const codes = Array.from(
      new Set(rows.map((r) => r.asset_old_code).filter(Boolean) as string[]),
    );
    const assetByCode = new Map<string, AdAsset>();
    const chunk = 300;
    for (let i = 0; i < codes.length; i += chunk) {
      const { data: page } = await context.supabase
        .from("assets")
        .select(ASSET_COLS)
        .in("old_code", codes.slice(i, i + chunk));
      for (const r of (page ?? []) as AssetRow[]) {
        const a = toAdAsset(r);
        if (a.old_code) assetByCode.set(a.old_code, a);
      }
    }

    const out: NewAdRow[] = rows.map((r) => {
      const favor = r.favor_start_date_contract;
      const since = favor
        ? Math.max(0, Math.floor((Date.now() - new Date(favor).getTime()) / 86400_000))
        : null;
      return {
        id: r.id,
        asset_old_code: r.asset_old_code,
        brand: r.brand,
        brand_eng: r.brand_eng,
        ad_contract: r.ad_contract,
        product_name: r.product_name,
        package_name: r.package_name,
        favor_start: favor,
        end_date_contract: r.end_date_contract,
        days_since_launch: since,
        asset: (r.asset_old_code && assetByCode.get(r.asset_old_code)) || null,
      };
    });
    out.sort((x, y) => (y.favor_start ?? "").localeCompare(x.favor_start ?? ""));

    const brands = new Set<string>();
    const contracts = new Set<string>();
    for (const r of out) {
      if (r.brand) brands.add(r.brand);
      if (r.ad_contract) contracts.add(r.ad_contract);
    }
    return {
      days,
      rows: out,
      totalRows: out.length,
      assetCount: new Set(out.map((r) => r.asset_old_code).filter(Boolean)).size,
      brandCount: brands.size,
      contractCount: contracts.size,
      withGeo: out.filter((r) => r.asset?.lat != null && r.asset?.lng != null).length,
    };
  });

/** Cheap counter for the sidebar badge ("มีโฆษณาขึ้นใหม่ N รายการ"). */
export const countNewlyLaunchedAds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ days: z.number().int().min(1).max(120).optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const days = data.days ?? 7;
    const { count } = await context.supabase
      .from("ad_contracts")
      .select("id", { count: "exact", head: true })
      .not("favor_start_date_contract", "is", null)
      .gte("favor_start_date_contract", windowStart(days))
      .lte("favor_start_date_contract", new Date().toISOString().slice(0, 10));
    return { days, count: count ?? 0 };
  });
