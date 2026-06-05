import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAssetHistorySyncBatch } from "@/lib/sync.server";

// Hourly cron hits this endpoint. The handler reads the schedule from
// app_settings and only triggers when the current Bangkok hour matches.
// Modes:
//   - "off"          : never auto-run
//   - "every_3h"     : 00, 03, 06, 09, 12, 15, 18, 21
//   - "daytime_3h"   : 06, 09, 12, 15, 18
//   - "daily_0530"   : once per day at 05:30 Bangkok (cron at 22:30 UTC)
//
// A separate daily cron at 22:30 UTC calls this endpoint with `?force=daily_0530`,
// which bypasses the hour check (since this handler is also triggered hourly at :00).
export const Route = createFileRoute("/api/public/hooks/sync-asset-history")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const force = url.searchParams.get("force");

        const { data: row } = await supabaseAdmin
          .from("app_settings")
          .select("value")
          .eq("key", "asset_history_schedule")
          .maybeSingle();
        const mode = ((row?.value as { mode?: string } | null)?.mode ?? "off") as
          | "off"
          | "every_3h"
          | "daytime_3h"
          | "daily_0530";
        const limit = Number((row?.value as { limit?: number } | null)?.limit ?? 25);

        // Per-table on/off — if assetHistory is explicitly disabled, skip even when
        // the schedule says to run.
        const { data: toggleRow } = await supabaseAdmin
          .from("app_settings")
          .select("value")
          .eq("key", "asset_sync_tables_enabled")
          .maybeSingle();
        const tablesEnabled = (toggleRow?.value ?? {}) as {
          asset?: boolean; pmSchedule?: boolean; assetHistory?: boolean;
        };
        if (tablesEnabled.assetHistory === false) {
          return new Response(
            JSON.stringify({ skipped: true, reason: "assetHistory disabled in app_settings.asset_sync_tables_enabled" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }


        // Bangkok hour (UTC+7)
        const nowBkk = new Date(Date.now() + 7 * 3600 * 1000);
        const hour = nowBkk.getUTCHours();

        // The daily_0530 mode is fired by a dedicated cron with ?force=daily_0530.
        // Skip if hourly cron hits without the force flag.
        let shouldRun = false;
        if (force === "daily_0530") {
          shouldRun = mode === "daily_0530";
        } else {
          const runHours =
            mode === "every_3h"
              ? [0, 3, 6, 9, 12, 15, 18, 21]
              : mode === "daytime_3h"
                ? [6, 9, 12, 15, 18]
                : [];
          shouldRun = runHours.includes(hour);
        }

        if (!shouldRun) {
          return new Response(
            JSON.stringify({ skipped: true, mode, hour, force }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        const result = await runAssetHistorySyncBatch(limit);
        return new Response(JSON.stringify({ mode, hour, force, ...result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
