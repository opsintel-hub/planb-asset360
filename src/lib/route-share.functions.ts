// Phase C — read-only mobile link for one or more day plans.
// Reuses the existing temporary-share table + public token endpoint.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RouteShareStop = {
  code: string;
  name: string | null;
  mediaType: string | null;
  department: string | null;
  lat: number;
  lng: number;
  risk: "critical" | "high" | "medium" | "low" | null;
};

export type RouteShareDay = {
  inspectorLabel: string;
  technician: string | null;
  day: number;
  meters: number;
  hours: number;
  start: { lat: number; lng: number; name: string } | null;
  end: { lat: number; lng: number; name: string } | null;
  stops: RouteShareStop[];
};

export type RouteSharePayload = {
  kind: "route-plan";
  title: string;
  createdByLabel?: string | null;
  days: RouteShareDay[];
};

const TTL_HOURS = 168; // 7 days — a work week of field use

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export const createRouteShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { payload: RouteSharePayload }) => {
    const p = input?.payload;
    if (!p || p.kind !== "route-plan" || !Array.isArray(p.days) || p.days.length === 0)
      throw new Error("invalid payload");
    const stops = p.days.reduce((s, d) => s + (d.stops?.length ?? 0), 0);
    if (stops > 4000) throw new Error("plan too large to share");
    return { payload: p };
  })
  .handler(async ({ data, context }) => {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000).toISOString();

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
