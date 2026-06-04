// Supabase Edge Function (Deno) — Sync MSSQL AssetHistory table only.
// Split out from sync-assets to avoid Worker CPU-time limits when the
// AssetHistory table is large.

// @ts-ignore deno npm specifier
import sql from "npm:mssql@10.0.2";
// @ts-ignore deno esm
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface AssetDbConn {
  host?: string;
  server?: string;
  port?: number | string;
  database?: string;
  username?: string;
  historyTable?: string;
  encrypt?: boolean;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function quoteTableName(raw: string): string {
  const parts = raw
    .split(".")
    .map((p) => p.replace(/[^a-zA-Z0-9_]/g, ""))
    .filter(Boolean);
  if (!parts.length) throw new Error("invalid table name");
  return parts.map((p) => `[${p}]`).join(".");
}

function parseHostPort(raw: string): { server: string; port: number } {
  const [s, p] = raw.split(":");
  return { server: s.trim(), port: p ? Number(p.trim()) : 1433 };
}

function pickStr(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (v != null && String(v).trim() !== "") return String(v);
  }
  return null;
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
    connectionTimeout: 30_000,
    requestTimeout: 120_000,
  });
}

async function runSync(
  admin: ReturnType<typeof createClient>,
  DB_PASSWORD: string,
  opts: { days: number; pageSize: number; reset: boolean; logId?: number },
) {
  const { days, pageSize, reset, logId } = opts;
  const finish = async (status: "success" | "error", message: string, rows: number) => {
    if (logId)
      await admin
        .from("sync_logs")
        .update({ status, message, rows_affected: rows, finished_at: new Date().toISOString() })
        .eq("id", logId);
  };

  let pool: { close: () => Promise<void>; request: () => { query: (q: string) => Promise<{ recordset: Record<string, unknown>[] }> } } | null = null;
  try {
    const { data: connRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "asset_db_connection")
      .maybeSingle();
    const conn = (connRow?.value ?? {}) as AssetDbConn;
    const host = conn.server ?? conn.host ?? "magicticket.magicsigncloud.com";
    const database = conn.database ?? "planb";
    const user = conn.username ?? "planb_viewer";
    const historyTable = quoteTableName((conn.historyTable ?? "AssetHistory").trim());

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

    
    // Probe columns first (TOP 0 returns schema only — extremely cheap)
    const probe = await pool!.request().query(`SELECT TOP 1 * FROM ${historyTable}`);
    const sample = (probe.recordset?.[0] ?? {}) as Record<string, unknown>;
    const availableCols = new Set(Object.keys(sample));
    const pickCol = (cands: string[]) => cands.find((c) => availableCols.has(c));

    const colOld = pickCol(["OldCode", "oldCode", "AssetCode", "Code"]);
    const colRef = pickCol(["RefNumber", "refNumber", "Ref", "DocNo"]);
    const colDate = pickCol(["ActionDate", "actionDate", "CreatedDate", "TransactionDate", "Date"]);
    const colAction = pickCol(["Action", "ActionType", "Type", "Operation", "Event"]);
    const colStatus = pickCol(["Status", "status"]);
    const colProject = pickCol(["Project", "project"]);

    const selectCols = [colOld, colRef, colDate, colAction, colStatus, colProject]
      .filter(Boolean)
      .map((c) => `[${c}]`)
      .join(",");
    if (!selectCols) throw new Error(`No mappable columns found. Available: ${[...availableCols].join(", ")}`);

    const maxRows = Number.isFinite((opts as { maxRows?: number }).maxRows)
      ? Math.max(100, Math.min(50000, Number((opts as { maxRows?: number }).maxRows)))
      : 10000;
    let list: Record<string, unknown>[] = [];
    let usedFilter = false;
    if (colDate) {
      try {
        const q = `SELECT TOP ${maxRows} ${selectCols} FROM ${historyTable} WHERE [${colDate}] >= DATEADD(day, -${days}, GETDATE()) ORDER BY [${colDate}] DESC`;
        const r = await pool!.request().query(q);
        list = (r.recordset ?? []) as Record<string, unknown>[];
        usedFilter = true;
      } catch {
        /* fallback below */
      }
    }
    if (!usedFilter) {
      const r = await pool!.request().query(`SELECT TOP ${maxRows} ${selectCols} FROM ${historyTable}`);
      list = (r.recordset ?? []) as Record<string, unknown>[];
    }

    if (reset) {
      await admin.from("mssql_asset_history").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }

    const nowIso = new Date().toISOString();
    const rows = list.map((item) => ({
      asset_old_code: colOld ? pickStr(item, [colOld]) : null,
      ref_number: colRef ? pickStr(item, [colRef]) : null,
      action_date: colDate ? pickStr(item, [colDate]) : null,
      action: colAction ? pickStr(item, [colAction]) : null,
      status: colStatus ? pickStr(item, [colStatus]) : null,
      project: colProject ? pickStr(item, [colProject]) : null,
      payload: null,
      synced_at: nowIso,
    }));


    if (reset) {
      await admin.from("mssql_asset_history").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }

    const nowIso = new Date().toISOString();
    const rows = list.map((item) => ({
      asset_old_code: pickStr(item, ["OldCode"]),
      ref_number: pickStr(item, ["RefNumber"]),
      action_date: pickStr(item, ["ActionDate"]),
      action: pickStr(item, ["Action"]),
      status: pickStr(item, ["Status"]),
      project: pickStr(item, ["Project"]),
      payload: null,
      synced_at: nowIso,
    }));


    let inserted = 0;
    for (let i = 0; i < rows.length; i += pageSize) {
      const slice = rows.slice(i, i + pageSize);
      if (!slice.length) continue;
      const { error } = await admin.from("mssql_asset_history").insert(slice);
      if (error) throw new Error(error.message);
      inserted += slice.length;
    }

    await pool!.close();
    pool = null;
    await finish("success", `synced ${inserted} rows (days=${days}, filtered=${usedFilter})`, inserted);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("sync-asset-history failed", msg);
    if (pool) await pool.close().catch(() => null);
    await finish("error", msg, 0);
  }
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

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { days?: number; reset?: boolean; pageSize?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }
  const days = Number.isFinite(body.days) ? Math.max(1, Math.min(3650, Number(body.days))) : 7;
  const pageSize = Number.isFinite(body.pageSize) ? Math.max(100, Math.min(2000, Number(body.pageSize!))) : 500;
  const reset = body.reset !== false;

  if (!DB_PASSWORD) {
    return jsonResponse({ ok: false, error: "MODERN_CORP_DB_PASSWORD secret not set" }, 500);
  }

  const { data: logRow } = await admin
    .from("sync_logs")
    .insert({ source: "mssql_asset_history", status: "running", message: `started (days=${days})` })
    .select("id")
    .single();
  const logId = logRow?.id as number | undefined;

  // Run in background to avoid CPU/wall-time limits on the request path
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(runSync(admin, DB_PASSWORD, { days, pageSize, reset, logId }));

  return jsonResponse({ ok: true, queued: true, logId, days, message: "started in background; check sync_logs" });
});
