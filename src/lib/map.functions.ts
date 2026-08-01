import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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


function parseLatLng(raw: unknown): [number, number] | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

export const listAssetsForMap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // pull all assets — 8k rows, one shot is fine.
    const rows: Array<{
      id: string;
      old_code: string | null;
      name: string | null;
      department: string | null;
      district: string | null;
      status: string | null;
      latitude: number | null;
      longitude: number | null;
      payload: Record<string, unknown> | null;
    }> = [];
    const pageSize = 1000;
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await context.supabase
        .from("assets")
        .select("id, old_code, name, department, district, status, latitude, longitude, payload")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      rows.push(...(data as typeof rows));
      if (data.length < pageSize) break;
      from += pageSize;
    }

    const assets: MapAsset[] = [];
    for (const r of rows) {
      let lat: number | null = r.latitude != null ? Number(r.latitude) : null;
      let lng: number | null = r.longitude != null ? Number(r.longitude) : null;
      if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        const p = (r.payload ?? {}) as Record<string, unknown>;
        const ll = parseLatLng(p.LatitudeLongitude);
        if (ll) { lat = ll[0]; lng = ll[1]; }
      }
      if (lat == null || lng == null) continue;
      const p = (r.payload ?? {}) as Record<string, unknown>;
      assets.push({
        id: r.id,
        old_code: r.old_code,
        name: r.name ?? (typeof p.Description === "string" ? p.Description : null),
        department: r.department,
        media_type: typeof p.MediaType === "string" ? p.MediaType : null,
        status: r.status,
        location: typeof p.Location === "string" ? p.Location : null,
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
