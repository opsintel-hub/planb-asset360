import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Public endpoint — bypasses auth. Reads a POI share by token.
// Returns 404 when missing, 410 when expired (and deletes the row).
export const Route = createFileRoute("/api/public/poi-share/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = params.token;
        if (!token || !/^[a-f0-9]{16,96}$/i.test(token)) {
          return new Response(JSON.stringify({ error: "invalid token" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const url = process.env.SUPABASE_URL!;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const supabase = createClient<Database>(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
          global: {
            fetch: (input, init) => {
              const h = new Headers(init?.headers);
              if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
                h.delete("Authorization");
              }
              h.set("apikey", key);
              return fetch(input, { ...init, headers: h });
            },
          },
        });

        // Use maybeSingle so we can distinguish expired vs missing.
        // The RLS policy for anon filters out expired rows automatically,
        // so both look like "no row" to us — we then check via service role.
        const { data, error } = await supabase
          .from("poi_shares")
          .select("payload, expires_at, created_at")
          .eq("token", token)
          .maybeSingle();

        if (error) {
          return new Response(JSON.stringify({ error: "lookup failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (!data) {
          // Row may be missing OR expired (RLS hides expired for anon).
          // Cleanup expired via admin, then respond as gone/not-found.
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: expiredRow } = await supabaseAdmin
              .from("poi_shares")
              .select("token")
              .eq("token", token)
              .maybeSingle();
            if (expiredRow) {
              await supabaseAdmin.from("poi_shares").delete().eq("token", token);
              return new Response(JSON.stringify({ error: "expired" }), {
                status: 410,
                headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
              });
            }
          } catch {
            // fall through to 404
          }
          return new Response(JSON.stringify({ error: "not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        }

        return new Response(
          JSON.stringify({
            payload: data.payload,
            expiresAt: data.expires_at,
            createdAt: data.created_at,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          },
        );
      },
    },
  },
});
