// Supabase Edge Function (Deno) — Explore MSSQL source database.
// Modes:
//   { mode: "list" }                      → list tables in current DB (with row counts)
//   { mode: "columns", table: "Name" }    → describe columns of one table
//   { mode: "preview", table, limit }     → return top N rows (default 10, max 50)

// @ts-ignore deno npm specifier
import sql from "npm:mssql@10.0.2";
// @ts-ignore deno esm
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseHostPort(raw: string): { server: string; port: number } {
  const [s, p] = raw.split(":");
  return { server: s.trim(), port: p ? Number(p.trim()) : 1433 };
}

// Strictly validate table identifier — schema.table or table only, letters/digits/_ only.
function safeIdent(raw: string): { schema: string; table: string; quoted: string } {
  const parts = raw
    .split(".")
    .map((p) => p.trim().replace(/^\[|\]$/g, ""))
    .filter(Boolean);
  if (!parts.length || parts.length > 2) throw new Error("invalid table identifier");
  for (const p of parts) {
    if (!/^[a-zA-Z0-9_]+$/.test(p)) throw new Error("invalid table identifier characters");
  }
  const schema = parts.length === 2 ? parts[0] : "dbo";
  const table = parts.length === 2 ? parts[1] : parts[0];
  return { schema, table, quoted: `[${schema}].[${table}]` };
}

async function connectMssql(c: {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
}) {
  return sql.connect({
    server: c.server,
    port: c.port,
    database: c.database,
    user: c.user,
    password: c.password,
    options: { encrypt: c.encrypt, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: 20_000,
    requestTimeout: 30_000,
  });
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

  if (!DB_PASSWORD) {
    return jsonResponse({ ok: false, error: "MODERN_CORP_DB_PASSWORD secret not set" }, 500);
  }

  let body: { mode?: string; table?: string; limit?: number } = {};
  try {
    body = await req.json();
  } catch { /* empty */ }

  const mode = body.mode ?? "list";
  const limit = Math.max(1, Math.min(50, Number(body.limit ?? 10)));

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  let pool: { close: () => Promise<void>; request: () => { query: (q: string) => Promise<{ recordset: Record<string, unknown>[] }> } } | null = null;

  try {
    const { data: connRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "asset_db_connection")
      .maybeSingle();
    const conn = (connRow?.value ?? {}) as {
      host?: string; server?: string; port?: number | string;
      database?: string; username?: string; encrypt?: boolean;
    };
    const host = conn.server ?? conn.host ?? "magicticket.magicsigncloud.com";
    const database = conn.database ?? "planb";
    const user = conn.username ?? "planb_viewer";
    const parsed = parseHostPort(host);
    const server = parsed.server;
    const port = conn.port ? Number(conn.port) : parsed.port;
    const encrypt = conn.encrypt ?? false;

    try {
      pool = await connectMssql({ server, port, database, user, password: DB_PASSWORD, encrypt });
    } catch (e) {
      if (encrypt) throw e;
      pool = await connectMssql({ server, port, database, user, password: DB_PASSWORD, encrypt: true });
    }

    if (mode === "list") {
      const q = `
        SELECT
          t.TABLE_SCHEMA  AS [schema],
          t.TABLE_NAME    AS [table],
          (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS c
             WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME) AS column_count,
          ISNULL(p.row_count, 0) AS row_count
        FROM INFORMATION_SCHEMA.TABLES t
        LEFT JOIN (
          SELECT s.name AS schema_name, o.name AS table_name, SUM(p.rows) AS row_count
          FROM sys.objects o
          JOIN sys.schemas s ON o.schema_id = s.schema_id
          JOIN sys.partitions p ON o.object_id = p.object_id
          WHERE o.type = 'U' AND p.index_id IN (0,1)
          GROUP BY s.name, o.name
        ) p ON p.schema_name = t.TABLE_SCHEMA AND p.table_name = t.TABLE_NAME
        WHERE t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
      `;
      const r = await pool!.request().query(q);
      await pool!.close();
      pool = null;
      return jsonResponse({ ok: true, mode, tables: r.recordset ?? [] });
    }

    if (!body.table) throw new Error("missing 'table' parameter");
    const ident = safeIdent(body.table);

    if (mode === "columns") {
      const q = `
        SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS maxlen
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '${ident.schema}' AND TABLE_NAME = '${ident.table}'
        ORDER BY ORDINAL_POSITION
      `;
      const r = await pool!.request().query(q);
      await pool!.close();
      pool = null;
      return jsonResponse({ ok: true, mode, schema: ident.schema, table: ident.table, columns: r.recordset ?? [] });
    }

    if (mode === "preview") {
      const colQ = `
        SELECT COLUMN_NAME AS name, DATA_TYPE AS type
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '${ident.schema}' AND TABLE_NAME = '${ident.table}'
        ORDER BY ORDINAL_POSITION
      `;
      const cols = await pool!.request().query(colQ);
      const rowQ = `SELECT TOP ${limit} * FROM ${ident.quoted}`;
      const rows = await pool!.request().query(rowQ);
      await pool!.close();
      pool = null;
      // Serialize values to strings/numbers for JSON safety
      const safeRows = (rows.recordset ?? []).map((row) => {
        const o: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          o[k] = v instanceof Date ? v.toISOString() : v;
        }
        return o;
      });
      return jsonResponse({
        ok: true,
        mode,
        schema: ident.schema,
        table: ident.table,
        columns: cols.recordset ?? [],
        rows: safeRows,
      });
    }

    throw new Error(`unknown mode '${mode}'`);
  } catch (e) {
    if (pool) await pool.close().catch(() => null);
    const msg = (e as Error).message;
    console.error("mssql-explore failed", msg);
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});
