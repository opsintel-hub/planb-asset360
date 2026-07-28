import { createFileRoute } from "@tanstack/react-router";

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

        // Use the service-role admin client so we can keep the SECURITY DEFINER
        // RPC locked down (no EXECUTE for anon/public). The handler itself
        // validates the token format above and only exposes the matching row.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: rows, error } = await supabaseAdmin.rpc("get_poi_share", {
          _token: token,
        });

        if (error) {
          return new Response(JSON.stringify({ error: "lookup failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const data = Array.isArray(rows) ? rows[0] : rows;

        if (!data) {
          // Row may be missing OR expired. Cleanup expired via admin,
          // then respond as gone/not-found.
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
