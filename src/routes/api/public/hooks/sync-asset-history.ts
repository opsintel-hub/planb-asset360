import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAssetHistorySyncBatch } from "@/lib/sync.server";

// Hourly cron hits this endpoint. The handler reads the schedule from
// app_settings and only triggers when the current Bangkok hour matches.
// Modes:
//   - "off"          : never auto-run
//   - "every_3h"     : 00, 03, 06, 09, 12, 15, 18, 21
//   - "daytime_3h"   : 06, 09, 12, 15, 18
export const Route = createFileRoute("/api/public/hooks/sync-asset-history")({
  server: {
    handlers: {
      POST: async () => {
        const { data: row } = await supabaseAdmin
          .from("app_settings")
          .select("value")
          .eq("key", "asset_history_schedule")
          .maybeSingle();
        const mode = ((row?.value as { mode?: string } | null)?.mode ?? "off") as
          | "off"
          | "every_3h"
          | "daytime_3h";
        const limit = Number((row?.value as { limit?: number } | null)?.limit ?? 200);

        // Bangkok hour (UTC+7)
        const nowBkk = new Date(Date.now() + 7 * 3600 * 1000);
        const hour = nowBkk.getUTCHours();

        const runHours =
          mode === "every_3h"
            ? [0, 3, 6, 9, 12, 15, 18, 21]
            : mode === "daytime_3h"
              ? [6, 9, 12, 15, 18]
              : [];

        if (!runHours.includes(hour)) {
          return new Response(
            JSON.stringify({ skipped: true, mode, hour }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        const result = await runAssetHistorySyncBatch(limit);
        return new Response(JSON.stringify({ mode, hour, ...result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
