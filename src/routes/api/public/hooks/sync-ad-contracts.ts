import { createFileRoute } from "@tanstack/react-router";

// CRM ad-contract sync endpoint.
//
//  • pg_cron (daily) calls it with ?token=... and an empty body → pull mode
//    (connects to the CRM MySQL view directly; only works when the host is
//    reachable from the internet).
//  • The IT team can POST { rows: [...] } with the same token → push mode,
//    used while the internal CRM host stays closed to the outside.
//
// Auth: shared token in `x-sync-token` header or `?token=`.
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

        let body: { rows?: unknown; archiveMissing?: boolean } = {};
        try {
          const text = await request.text();
          if (text.trim()) body = JSON.parse(text) as typeof body;
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "invalid JSON body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { pullAdContractsFromCrm, ingestPushedAdContracts } = await import("@/lib/ad-contracts.server");

        if (Array.isArray(body.rows)) {
          if (body.rows.length > 20000) {
            return new Response(JSON.stringify({ ok: false, error: "too many rows (max 20000 per request)" }), {
              status: 413,
              headers: { "Content-Type": "application/json" },
            });
          }
          const res = await ingestPushedAdContracts(
            body.rows as Record<string, unknown>[],
            body.archiveMissing !== false,
          );
          return Response.json(res, { status: res.ok ? 200 : 500 });
        }

        const res = await pullAdContractsFromCrm();
        return Response.json(res, { status: res.ok ? 200 : 500 });
      },
    },
  },
});
