// Supabase Edge Function (Deno) — Sync MSSQL AssetHistory with real
// cursor-based pagination. Each invocation processes ONE batch then
// self-invokes for the next batch until the source is exhausted.

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

interface BatchOpts {
  days: number;
  batchSize: number;
  reset: boolean;
  beforeDate?: string;
  batchIndex: number;
  maxBatches: number;
  logId?: number;
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

function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function isoOrNull(v: unknown): string | null {
  const d = toDate(v);
  return d ? d.toISOString() : null;
}

async function runBatch(
  admin: ReturnType<typeof createClient>,
  DB_PASSWORD: string,
  SUPABASE_URL: string,
  SERVICE_KEY: string,
  opts: BatchOpts,
) {
  const { days, batchSize, reset, beforeDate, batchIndex, maxBatches, logId } = opts;
  const setLog = async (status: "success" | "error", message: string, rows: number) => {
    if (logId)
      await admin
        .from("sync_logs")
        .update({ status, message, rows_affected: rows, finished_at: new Date().toISOString() })
        .eq("id", logId);
  };

  let pool: any = null;
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

    // Probe columns
    const probe = await pool!.request().query(`SELECT TOP 1 * FROM ${historyTable}`);
    const sample = (probe.recordset?.[0] ?? {}) as Record<string, unknown>;
    const availableCols = new Set(Object.keys(sample));
    const has = (c: string) => availableCols.has(c);

    // Fixed mapping per spec: cursor=CreatedDate, action=Status
    const colDate = "CreatedDate";
    const colAction = "Status";
    const colOld = has("OldCode") ? "OldCode" : has("AssetCode") ? "AssetCode" : null;
    const colRef = has("RefNumber") ? "RefNumber" : has("DocNo") ? "DocNo" : null;
    const colStatus = has("Status") ? "Status" : null;
    const colProject = has("Project") ? "Project" : null;

    if (!has(colDate)) {
      throw new Error("CreatedDate column not found on AssetHistory — required as cursor");
    }

    // Build query with parameterized cursor (avoids timezone string-parsing bugs in MSSQL)
    const req = pool!.request();
    let where = `[${colDate}] >= (SELECT MAX(d) FROM (VALUES (DATEADD(month, -12, GETDATE())), ('2026-01-01')) AS v(d))`;
    if (beforeDate) {
      const d = toDate(beforeDate);
      if (d) {
        req.input("beforeDate", sql.DateTimeOffset, d);
        // Strict less-than guarantees we always advance off the boundary even when
        // many rows share the exact same CreatedDate.
        where += ` AND [${colDate}] < @beforeDate`;
      }
    }
    const q = `SELECT TOP ${batchSize} * FROM ${historyTable} WHERE ${where} ORDER BY [${colDate}] DESC`;
    const r = await req.query(q);
    const list = (r.recordset ?? []) as Record<string, unknown>[];

    // First batch only: wipe target if reset
    if (reset && batchIndex === 0) {
      // Truncate via delete in chunks since some envs disallow TRUNCATE via PostgREST
      await admin.from("mssql_asset_history").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }

    const nowIso = new Date().toISOString();
    const rows = list.map((item) => {
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item)) {
        payload[k] = v instanceof Date ? v.toISOString() : v;
      }
      return {
        asset_old_code: colOld ? pickStr(item, [colOld]) : null,
        ref_number: colRef ? pickStr(item, [colRef]) : null,
        action_date: isoOrNull(item[colDate]),
        action: pickStr(item, [colAction]),
        status: colStatus ? pickStr(item, [colStatus]) : null,
        project: colProject ? pickStr(item, [colProject]) : null,
        payload,
        synced_at: nowIso,
      };
    });

    let inserted = 0;
    const chunk = 500;
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      const { error } = await admin.from("mssql_asset_history").insert(slice);
      if (error) throw new Error(error.message);
      inserted += slice.length;
    }

    // Compute next cursor: oldest date in this batch (last row when ORDER BY DESC)
    const lastDateRaw = list.length ? list[list.length - 1][colDate] : null;
    const nextCursor = lastDateRaw ? isoOrNull(lastDateRaw) : null;
    const isFull = list.length === batchSize;

    // SAFETY GUARD: if cursor didn't advance (same value as input beforeDate),
    // STOP the chain. This prevents the runaway loop we hit when timestamps tie
    // on a boundary and the strict-less-than filter no longer makes progress.
    const noProgress = !!beforeDate && !!nextCursor && nextCursor === beforeDate;
    const hasMore = isFull && nextCursor && !noProgress && batchIndex + 1 < maxBatches;

    await pool!.close();
    pool = null;

    const reason = !isFull
      ? "source exhausted"
      : noProgress
        ? "STOPPED: cursor stuck (timestamp tie) — investigate"
        : batchIndex + 1 >= maxBatches
          ? "maxBatches reached"
          : "continuing";

    await setLog(
      "success",
      `batch #${batchIndex} synced ${inserted} rows (cursor<${beforeDate ?? "now"}, next=${nextCursor ?? "n/a"}) — ${hasMore ? "chaining" : reason}`,
      inserted,
    );

    if (hasMore) {
      const { data: nextLog } = await admin
        .from("sync_logs")
        .insert({
          source: "mssql_asset_history",
          status: "running",
          message: `batch #${batchIndex + 1} starting (cursor<${nextCursor})`,
        })
        .select("id")
        .single();
      const nextLogId = nextLog?.id as number | undefined;

      const url = `${SUPABASE_URL}/functions/v1/sync-asset-history`;
      const body = JSON.stringify({
        days,
        batchSize,
        reset: false,
        beforeDate: nextCursor,
        batchIndex: batchIndex + 1,
        maxBatches,
        _logId: nextLogId,
      });
      // @ts-ignore EdgeRuntime
      EdgeRuntime.waitUntil(
        fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
          body,
        }).catch(async (err) => {
          if (nextLogId)
            await admin
              .from("sync_logs")
              .update({
                status: "error",
                message: `failed to chain next batch: ${(err as Error).message}`,
                finished_at: new Date().toISOString(),
              })
              .eq("id", nextLogId);
        }),
      );
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.error("sync-asset-history batch failed", msg);
    if (pool) await pool.close().catch(() => null);
    await setLog("error", `batch #${batchIndex} failed: ${msg}`, 0);
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

  let body: {
    days?: number;
    batchSize?: number;
    reset?: boolean;
    beforeDate?: string;
    batchIndex?: number;
    maxBatches?: number;
    _logId?: number;
  } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }

  const days = Number.isFinite(body.days) ? Math.max(1, Math.min(3650, Number(body.days))) : 90;
  const batchSize = Number.isFinite(body.batchSize)
    ? Math.max(100, Math.min(10000, Number(body.batchSize)))
    : 10000;
  const reset = body.reset !== false;
  const batchIndex = Number.isFinite(body.batchIndex) ? Math.max(0, Number(body.batchIndex)) : 0;
  const maxBatches = Number.isFinite(body.maxBatches)
    ? Math.max(1, Math.min(20000, Number(body.maxBatches)))
    : 10000;
  const beforeDate = typeof body.beforeDate === "string" ? body.beforeDate : undefined;

  if (!DB_PASSWORD) {
    return jsonResponse({ ok: false, error: "MODERN_CORP_DB_PASSWORD secret not set" }, 500);
  }

  let logId = body._logId;
  if (!logId) {
    const { data: logRow } = await admin
      .from("sync_logs")
      .insert({
        source: "mssql_asset_history",
        status: "running",
        message: `batch #${batchIndex} starting (days=${days}, batchSize=${batchSize})`,
      })
      .select("id")
      .single();
    logId = logRow?.id as number | undefined;
  }

  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(
    runBatch(admin, DB_PASSWORD, SUPABASE_URL, SERVICE_KEY, {
      days,
      batchSize,
      reset,
      beforeDate,
      batchIndex,
      maxBatches,
      logId,
    }),
  );

  return jsonResponse({
    ok: true,
    queued: true,
    logId,
    batchIndex,
    days,
    batchSize,
    message: "batch queued; subsequent batches will auto-chain. Watch sync_logs.",
  });
});
