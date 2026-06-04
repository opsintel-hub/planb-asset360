// Supabase Edge Function (Deno) — Sync MSSQL Asset_PM_Schedule table only.
// Split out from sync-assets to avoid Worker CPU-time limits.

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
  pmScheduleTable?: string;
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

  const { data: logRow } = await admin
    .from("sync_logs")
    .insert({ source: "asset_pm_schedule", status: "running", message: "started (edge:sync-pm-schedules)" })
    .select("id")
    .single();
  const logId = logRow?.id as number | undefined;

  const finish = async (status: "success" | "error", message: string, rows: number) => {
    if (logId)
      await admin
        .from("sync_logs")
        .update({ status, message, rows_affected: rows, finished_at: new Date().toISOString() })
        .eq("id", logId);
  };

  let pool: { close: () => Promise<void>; request: () => { query: (q: string) => Promise<{ recordset: Record<string, unknown>[] }> } } | null = null;

  try {
    if (!DB_PASSWORD) throw new Error("MODERN_CORP_DB_PASSWORD secret not set");

    const { data: connRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "asset_db_connection")
      .maybeSingle();
    const conn = (connRow?.value ?? {}) as AssetDbConn;
    const host = conn.server ?? conn.host ?? "magicticket.magicsigncloud.com";
    const database = conn.database ?? "planb";
    const user = conn.username ?? "planb_viewer";
    const pmTable = quoteTableName((conn.pmScheduleTable ?? "Asset_PM_Schedule").trim());

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

    const r = await pool!.request().query(`SELECT * FROM ${pmTable}`);
    const list = (r.recordset ?? []) as Record<string, unknown>[];

    await admin.from("asset_pm_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Dedupe by natural key
    const map = new Map<string, Record<string, unknown>>();
    for (const item of list) {
      const row = {
        project: pickStr(item, ["Project", "project"]),
        asset_old_code: pickStr(item, [
          "OldCode", "oldCode", "old_code",
          "OlaCode", "olaCode",
          "AssetCode", "assetCode", "Code", "code",
        ]),
        ref_number: pickStr(item, ["RefNumber", "refNumber", "ref_number"]),
        schedule_date: pickStr(item, ["ScheduleDate", "scheduleDate", "schedule_date"]),
        status: pickStr(item, ["Status", "status"]),
        inform_position: pickStr(item, [
          "InformPosition", "informPosition",
          "InformPsition", "informPsition",
          "Inform_Position",
        ]),
        asset_status: pickStr(item, [
          "AssetStatus", "assetStatus",
          "AssetSataus", "assetSataus",
          "Asset_Status",
        ]),
        payload: item,
        synced_at: new Date().toISOString(),
      };
      const key = `${row.ref_number ?? ""}|${row.asset_old_code ?? ""}|${row.schedule_date ?? ""}`;
      map.set(key, row);
    }
    const rows = Array.from(map.values());

    let inserted = 0;
    const batch = 500;
    for (let i = 0; i < rows.length; i += batch) {
      const slice = rows.slice(i, i + batch);
      if (!slice.length) continue;
      const { error } = await admin.from("asset_pm_schedules").insert(slice);
      if (error) throw new Error(error.message);
      inserted += slice.length;
    }

    await pool!.close();
    pool = null;
    await finish("success", `synced ${inserted} PM schedules`, inserted);
    return jsonResponse({ ok: true, rows: inserted });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("sync-pm-schedules failed", msg);
    if (pool) await pool.close().catch(() => null);
    await finish("error", msg, 0);
    return jsonResponse({ ok: false, rows: 0, error: msg });
  }
});
