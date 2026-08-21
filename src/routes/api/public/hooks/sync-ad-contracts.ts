import { createFileRoute } from "@tanstack/react-router";

// CRM ad-contract sync endpoint — called daily by pg_cron
// (`crm-sync-ad-contracts-daily`) with `?token=` / `x-sync-token`.
// It pulls straight from the CRM MySQL view `view_productstatus`.
export const Route = createFileRoute("/api/public/hooks/sync-ad-contracts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["CRM_SYNC_TOKEN"];
        const url = new URL(request.url);
        const provided = request.headers.get("x-sync-token") ?? url.searchParams.get("token") ?? "";
        if (!expected || provided !== expected) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { pullAdContractsFromCrm } = await import("@/lib/ad-contracts.server");
        const res = await pullAdContractsFromCrm();
        return Response.json(res, { status: res.ok ? 200 : 500 });
      },
    },
  },
});
