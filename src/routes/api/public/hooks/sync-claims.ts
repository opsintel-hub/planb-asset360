import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runClaimSync } from "@/lib/sync.server";

// Called by pg_cron every 15 minutes. Runs claim sync only when
// app_settings.claim_auto_sync is true.
export const Route = createFileRoute("/api/public/hooks/sync-claims")({
  server: {
    handlers: {
      POST: async () => {
        const { data: row } = await supabaseAdmin
          .from("app_settings")
          .select("value")
          .eq("key", "claim_auto_sync")
          .maybeSingle();
        const enabled = row?.value === true || (row?.value as { enabled?: boolean } | null)?.enabled === true;
        if (!enabled) {
          return new Response(
            JSON.stringify({ skipped: true, reason: "claim_auto_sync is off" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        try {
          const result = await runClaimSync();
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ ok: false, error: (e as Error).message }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
