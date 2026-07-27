import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { POI, POIMatch } from "./poi-search.functions";
import type { Bbox } from "./overpass";

export type PoiShareAsset = {
  id: string;
  old_code: string | null;
  name: string | null;
  department: string | null;
  media_type: string | null;
  location: string | null;
  lat: number;
  lng: number;
};

export type PoiSharePayload = {
  pois: POI[];
  matches: POIMatch[];
  radiusM: number;
  matchMode: "any" | "all";
  bbox: Bbox;
  presetKeys: string[];
  freeText: string;
  chipProjects: string[];
  chipMedia: string[];
  project: string;
  media: string;
  assets: PoiShareAsset[];
  createdByLabel?: string | null;
};

const TTL_HOURS = 72;

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export const createPoiShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { payload: PoiSharePayload }) => {
    if (!input?.payload || typeof input.payload !== "object") throw new Error("invalid payload");
    return input;
  })
  .handler(async ({ data, context }) => {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000).toISOString();

    // Lazy sweep of expired rows (cheap: index on expires_at).
    await context.supabase.from("poi_shares").delete().lt("expires_at", new Date().toISOString());

    const { error } = await context.supabase.from("poi_shares").insert({
      token,
      payload: data.payload as never,
      created_by: context.userId,
      expires_at: expiresAt,
    });
    if (error) throw new Error(error.message);

    return { token, expiresAt, ttlHours: TTL_HOURS };
  });
