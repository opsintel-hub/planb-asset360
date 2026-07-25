import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type PlaceSearchResult = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  viewport?: { north: number; south: number; east: number; west: number };
};

const inputSchema = z.object({
  query: z.string().trim().min(1).max(200),
});

export const searchPlacesText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data }): Promise<{ results: PlaceSearchResult[] }> => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
      throw new Error("ยังไม่ได้เชื่อม Google Maps connector");
    }

    const resp = await fetch(
      "https://connector-gateway.lovable.dev/google_maps/places/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
          "Content-Type": "application/json",
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location,places.viewport",
        },
        body: JSON.stringify({
          textQuery: data.query,
          languageCode: "th",
          regionCode: "TH",
          maxResultCount: 6,
        }),
      },
    );

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`ค้นหาสถานที่ล้มเหลว (${resp.status}): ${body.slice(0, 160)}`);
    }
    const payload = (await resp.json()) as {
      places?: Array<{
        id?: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
        viewport?: {
          low?: { latitude?: number; longitude?: number };
          high?: { latitude?: number; longitude?: number };
        };
      }>;
    };

    const results: PlaceSearchResult[] = [];
    for (const p of payload.places ?? []) {
      const lat = p.location?.latitude;
      const lng = p.location?.longitude;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      const viewport =
        p.viewport?.low?.latitude != null &&
        p.viewport?.low?.longitude != null &&
        p.viewport?.high?.latitude != null &&
        p.viewport?.high?.longitude != null
          ? {
              south: p.viewport.low.latitude,
              west: p.viewport.low.longitude,
              north: p.viewport.high.latitude,
              east: p.viewport.high.longitude,
            }
          : undefined;
      results.push({
        id: p.id ?? `${lat},${lng}`,
        name: p.displayName?.text ?? p.formattedAddress ?? "สถานที่",
        address: p.formattedAddress ?? "",
        lat,
        lng,
        viewport,
      });
    }
    return { results };
  });
