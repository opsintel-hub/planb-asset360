import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SavedLocation = {
  id: string;
  user_id: string | null;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
};

export type SavedRouteKind = "corridor" | "inspection" | "monitoring";

export type SavedRoute = {
  id: string;
  user_id: string;
  name: string;
  kind: SavedRouteKind;
  origin: { lat: number; lng: number; name?: string | null } | null;
  waypoints: Array<{ lat: number; lng: number; asset_id?: string | null; old_code?: string | null; name?: string | null }>;
  road_polyline: Array<[number, number]> | null;
  radius_m: number;
  notes: string | null;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
};

// ---------- Saved Locations ----------

export const listSavedLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("map_saved_locations")
      .select("*")
      .order("is_shared", { ascending: false })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as SavedLocation[] };
  });

export const upsertSavedLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id?: string | null;
    name: string;
    address?: string | null;
    lat: number;
    lng: number;
    is_shared?: boolean;
  }) => d)
  .handler(async ({ data, context }) => {
    const payload = {
      user_id: context.userId,
      name: data.name.trim(),
      address: data.address ?? null,
      lat: data.lat,
      lng: data.lng,
      is_shared: !!data.is_shared,
    };
    if (data.id) {
      const { data: row, error } = await (context.supabase as any)
        .from("map_saved_locations")
        .update(payload)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return row as SavedLocation;
    }
    const { data: row, error } = await (context.supabase as any)
      .from("map_saved_locations")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as SavedLocation;
  });

export const deleteSavedLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("map_saved_locations")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Saved Routes ----------

export const listSavedRoutes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("map_saved_routes")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as SavedRoute[] };
  });

export const upsertSavedRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id?: string | null;
    name: string;
    kind: SavedRouteKind;
    origin?: SavedRoute["origin"];
    waypoints: SavedRoute["waypoints"];
    road_polyline?: SavedRoute["road_polyline"];
    radius_m: number;
    notes?: string | null;
    is_shared?: boolean;
  }) => d)
  .handler(async ({ data, context }) => {
    const payload = {
      user_id: context.userId,
      name: data.name.trim(),
      kind: data.kind,
      origin: data.origin ?? null,
      waypoints: data.waypoints ?? [],
      road_polyline: data.road_polyline ?? null,
      radius_m: Math.max(10, Math.floor(data.radius_m)),
      notes: data.notes ?? null,
      is_shared: !!data.is_shared,
    };
    if (data.id) {
      const { data: row, error } = await (context.supabase as any)
        .from("map_saved_routes")
        .update(payload)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return row as SavedRoute;
    }
    const { data: row, error } = await (context.supabase as any)
      .from("map_saved_routes")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as SavedRoute;
  });

export const deleteSavedRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("map_saved_routes")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
