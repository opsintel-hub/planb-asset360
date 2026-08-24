import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchAllPaged } from "@/lib/ad-paging";

export type MapAsset = {
  id: string;
  old_code: string | null;
  name: string | null;
  department: string | null;
  media_type: string | null;
  status: string | null;
  location: string | null;
  district?: string | null;
  lat: number;
  lng: number;
};

type MapRow = {
  id: string;
  old_code: string | null;
  name: string | null;
  department: string | null;
  district: string | null;
  status: string | null;
  media_type: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
};

const MAP_COLS = "id, old_code, name, department, district, status, media_type, location, latitude, longitude";

export const listAssetsForMap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // `assets_map` is a lightweight view that already resolves name /
    // media_type / location / lat-lng out of `payload`, so we no longer ship
    // ~7 MB of raw JSON to render 8k pins. Pages are fetched concurrently.
    const db = context.supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => { range: (a: number, b: number) => PromiseLike<{ data: MapRow[] | null; error: { message: string } | null }> };
      };
    };
    const rows = await fetchAllPaged<MapRow>((from, to) => db.from("assets_map").select(MAP_COLS).range(from, to));

    const assets: MapAsset[] = [];
    for (const r of rows) {
      const lat = r.latitude != null ? Number(r.latitude) : null;
      const lng = r.longitude != null ? Number(r.longitude) : null;
      if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      assets.push({
        id: r.id,
        old_code: r.old_code,
        name: r.name,
        department: r.department,
        media_type: r.media_type,
        status: r.status,
        location: r.location,
        district: r.district,
        lat,
        lng,
      });
    }

    const departments = Array.from(
      new Set(assets.map((a) => a.department).filter(Boolean) as string[]),
    ).sort();
    const mediaTypes = Array.from(
      new Set(assets.map((a) => a.media_type).filter(Boolean) as string[]),
    ).sort();
    return { assets, departments, mediaTypes };
  });


export const listOpenClaimOldCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, count } = await context.supabase
      .from("claim_tickets")
      .select("asset_old_code", { count: "exact" })
      .limit(5000);
    const codes = new Set<string>();
    for (const r of data ?? []) if (r.asset_old_code) codes.add(r.asset_old_code);
    return { oldCodes: Array.from(codes), totalTickets: count ?? (data?.length ?? 0) };
  });
