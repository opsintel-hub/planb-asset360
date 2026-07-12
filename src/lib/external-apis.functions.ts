import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { OVERPASS_ENDPOINT } from "./overpass";

export type PingResult = {
  ok: boolean;
  latencyMs: number;
  message: string;
  sampleCount?: number;
};

async function timed<T>(fn: () => Promise<T>): Promise<{ res: T; ms: number }> {
  const t0 = Date.now();
  const res = await fn();
  return { res, ms: Date.now() - t0 };
}

export const pingOverpass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<PingResult> => {
    try {
      const query = `[out:json][timeout:10];node["amenity"="cafe"](13.74,100.53,13.76,100.55);out 3;`;
      const { res, ms } = await timed(async () => {
        const r = await fetch(OVERPASS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { elements?: unknown[] };
      });
      const count = res.elements?.length ?? 0;
      return { ok: true, latencyMs: ms, message: `OK — ตัวอย่าง ${count} POI`, sampleCount: count };
    } catch (e) {
      return { ok: false, latencyMs: 0, message: (e as Error).message };
    }
  });

export const pingOsrm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<PingResult> => {
    try {
      const url = "https://router.project-osrm.org/route/v1/driving/100.5231,13.7461;100.5637,13.7278?overview=false";
      const { res, ms } = await timed(async () => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { routes?: { distance: number }[] };
      });
      const dist = res.routes?.[0]?.distance ?? 0;
      return { ok: true, latencyMs: ms, message: `OK — เส้นทางทดสอบ ${(dist / 1000).toFixed(2)} km` };
    } catch (e) {
      return { ok: false, latencyMs: 0, message: (e as Error).message };
    }
  });

export const pingNominatim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<PingResult> => {
    try {
      const url = "https://nominatim.openstreetmap.org/search?q=Bangkok&format=json&limit=1";
      const { res, ms } = await timed(async () => {
        const r = await fetch(url, { headers: { "User-Agent": "AssetHistory360/1.0" } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as unknown[];
      });
      return { ok: true, latencyMs: ms, message: `OK — คืน ${res.length} รายการ` };
    } catch (e) {
      return { ok: false, latencyMs: 0, message: (e as Error).message };
    }
  });
