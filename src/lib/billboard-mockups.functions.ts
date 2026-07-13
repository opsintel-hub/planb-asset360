import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BillboardMockupOverlay = {
  x: number; // % from left
  y: number; // % from top
  w: number; // % width
  h: number; // % height
  opacity: number; // 0..1
  rotation: number; // degrees
};

export type BillboardMockup = {
  id: string;
  old_code: string;
  storage_path: string;
  image_url: string; // signed URL
  title: string | null;
  note: string | null;
  overlay: BillboardMockupOverlay;
  created_at: string;
  updated_at: string;
};

const SIGNED_URL_TTL = 60 * 60; // 1h

async function signPath(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  path: string,
): Promise<string> {
  const { data } = await supabase.storage
    .from("billboard-mockups")
    .createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? "";
}

export const listBillboardMockups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { oldCode: string }) => {
    if (!input?.oldCode || typeof input.oldCode !== "string") throw new Error("invalid oldCode");
    return { oldCode: input.oldCode };
  })
  .handler(async ({ data, context }): Promise<BillboardMockup[]> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("billboard_mockups")
      .select("id, old_code, storage_path, image_url, title, note, overlay, created_at, updated_at")
      .eq("old_code", data.oldCode)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const out: BillboardMockup[] = [];
    for (const r of rows ?? []) {
      const signed = await signPath(supabase, r.storage_path as string);
      out.push({
        id: r.id as string,
        old_code: r.old_code as string,
        storage_path: r.storage_path as string,
        image_url: signed || (r.image_url as string),
        title: (r.title as string) ?? null,
        note: (r.note as string) ?? null,
        overlay: r.overlay as BillboardMockupOverlay,
        created_at: r.created_at as string,
        updated_at: r.updated_at as string,
      });
    }
    return out;
  });

export const createBillboardMockup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { oldCode: string; storagePath: string; title?: string; note?: string }) => {
    if (!input?.oldCode || !input?.storagePath) throw new Error("invalid input");
    return {
      oldCode: input.oldCode,
      storagePath: input.storagePath,
      title: input.title ?? null,
      note: input.note ?? null,
    };
  })
  .handler(async ({ data, context }): Promise<BillboardMockup> => {
    const { supabase, userId } = context;
    const { data: inserted, error } = await supabase
      .from("billboard_mockups")
      .insert({
        old_code: data.oldCode,
        storage_path: data.storagePath,
        image_url: "",
        title: data.title,
        note: data.note,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const signed = await signPath(supabase, data.storagePath);
    return {
      id: inserted.id,
      old_code: inserted.old_code,
      storage_path: inserted.storage_path,
      image_url: signed,
      title: inserted.title,
      note: inserted.note,
      overlay: inserted.overlay as BillboardMockupOverlay,
      created_at: inserted.created_at,
      updated_at: inserted.updated_at,
    };
  });

export const updateBillboardMockup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id: string;
    title?: string | null;
    note?: string | null;
    overlay?: BillboardMockupOverlay;
  }) => {
    if (!input?.id) throw new Error("invalid id");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const patch: { title?: string | null; note?: string | null; overlay?: BillboardMockupOverlay } = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.note !== undefined) patch.note = data.note;
    if (data.overlay !== undefined) patch.overlay = data.overlay;
    const { error } = await supabase.from("billboard_mockups").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBillboardMockup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("invalid id");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row } = await supabase
      .from("billboard_mockups")
      .select("storage_path")
      .eq("id", data.id)
      .single();
    if (row?.storage_path) {
      await supabase.storage.from("billboard-mockups").remove([row.storage_path as string]);
    }
    const { error } = await supabase.from("billboard_mockups").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Street View Static image via Google Maps Platform gateway → base64 data URL for exports.
export const getStreetViewStaticImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { lat: number; lng: number; heading?: number; size?: string }) => {
    const lat = Number(input?.lat);
    const lng = Number(input?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("invalid coords");
    return {
      lat,
      lng,
      heading: Number.isFinite(input?.heading) ? Number(input.heading) : 0,
      size: input?.size ?? "640x360",
    };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; dataUrl?: string; error?: string }> => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
      return { ok: false, error: "Google Maps connector ยังไม่พร้อม" };
    }
    const url = `https://connector-gateway.lovable.dev/google_maps/maps/api/streetview?size=${encodeURIComponent(
      data.size,
    )}&location=${data.lat},${data.lng}&heading=${data.heading}&pitch=0&fov=80`;
    try {
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
        },
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${t.slice(0, 120)}` };
      }
      const buf = new Uint8Array(await resp.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      const b64 = btoa(bin);
      return { ok: true, dataUrl: `data:image/jpeg;base64,${b64}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

export const pingGoogleMaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ ok: boolean; latencyMs: number; message: string }> => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
      return { ok: false, latencyMs: 0, message: "ยังไม่ได้เชื่อม Google Maps connector" };
    }
    const t0 = Date.now();
    try {
      const url = `https://connector-gateway.lovable.dev/google_maps/maps/api/streetview/metadata?location=13.7461,100.5231`;
      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
        },
      });
      const ms = Date.now() - t0;
      if (!r.ok) return { ok: false, latencyMs: ms, message: `HTTP ${r.status}` };
      const j = (await r.json()) as { status?: string };
      return { ok: true, latencyMs: ms, message: `OK — Street View metadata: ${j.status ?? "?"}` };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, message: (e as Error).message };
    }
  });
