// Temporary debug function: query MSSQL AssetHistory directly to verify RefNumber at source.
// @ts-ignore deno npm specifier
import sql from "npm:mssql@10.0.2";
// @ts-ignore deno esm
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function parseHostPort(raw: string) {
  const [s, p] = raw.split(":");
  return { server: s.trim(), port: p ? Number(p.trim()) : 1433 };
}

function quoteTableName(raw: string): string {
  const parts = raw.split(".").map((p) => p.replace(/[^a-zA-Z0-9_]/g, "")).filter(Boolean);
  return parts.map((p) => `[${p}]`).join(".");
}

// @ts-ignore Deno
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // @ts-ignore Deno
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  // @ts-ignore Deno
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // @ts-ignore Deno
  const DB_PASSWORD = Deno.env.get("MODERN_CORP_DB_PASSWORD");
  if (!DB_PASSWORD) return new Response(JSON.stringify({ error: "no password" }), { status: 500, headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const oldCode = String(body.oldCode ?? "DP911");
  const category = String(body.category ?? "Monitoring");
  const fromDate = String(body.fromDate ?? "2026-06-01");
  const toDate = String(body.toDate ?? "2026-06-22");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: connRow } = await admin.from("app_settings").select("value").eq("key", "asset_db_connection").maybeSingle();
  const conn = (connRow?.value ?? {}) as any;
  const host = conn.server ?? conn.host ?? "magicticket.magicsigncloud.com";
  const database = conn.database ?? "planb";
  const user = conn.username ?? "planb_viewer";
  const historyTable = quoteTableName((conn.historyTable ?? "AssetHistory").trim());
  const { server, port: p } = parseHostPort(host);
  const port = conn.port ? Number(conn.port) : p;

  let pool: any = null;
  try {
    try {
      pool = await sql.connect({ server, port, database, user, password: DB_PASSWORD,
        options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
        connectionTimeout: 30_000, requestTimeout: 60_000 });
    } catch {
      pool = await sql.connect({ server, port, database, user, password: DB_PASSWORD,
        options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
        connectionTimeout: 30_000, requestTimeout: 60_000 });
    }

    const r = await pool.request()
      .input("oc", sql.NVarChar, oldCode)
      .input("cat", sql.NVarChar, category)
      .input("f", sql.DateTime2, new Date(fromDate))
      .input("t", sql.DateTime2, new Date(toDate))
      .query(`
        SELECT *
        FROM ${historyTable}
        WHERE [OldCode] = @oc
          AND [Category] = @cat
          AND TRY_CAST([CreatedDate] AS datetime2) BETWEEN @f AND @t
        ORDER BY [CreatedDate] DESC
      `);

    const rows = r.recordset ?? [];
    // Pick the most relevant columns to display compactly
    const compact = rows.map((row: any) => ({
      RefNumber: row.RefNumber ?? row.RefNo ?? row.Ref_Number ?? null,
      OldCode: row.OldCode,
      Category: row.Category,
      Status: row.Status,
      AssetStatus: row.AssetStatus,
      CreatedDate: row.CreatedDate,
      UpdatedDate: row.UpdatedDate,
      Project: row.Project,
      MediaType: row.MediaType,
      _allKeys: Object.keys(row),
    }));

    await pool.close();
    return new Response(JSON.stringify({ count: rows.length, rows: compact, sample_full: rows[0] ?? null }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    if (pool) await pool.close().catch(() => null);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
