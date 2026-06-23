// Supabase Edge Function (Deno) — Incremental sync for MSSQL AssetHistory.
//
// Strategy (no auto-id available on source):
//   - Natural key = (OldCode, CreatedDate, Status) → upsert via unique index.
//   - Cursor      = GREATEST(CreatedDate, UpdatedDate) + (OldCode, RefNumber) tie-breaker.
//   - Persist last cursor position in app_settings key `mssql_asset_history_cursor`.
//   - Window: last 12 months OR since 2026-01-01 (whichever is later).
//   - reset=true wipes the table AND resets the cursor → full re-pull.
//   - reset=false (default) = incremental: only rows with cursor > saved value.

// @ts-ignore deno npm specifier
import sql from "npm:mssql@10.0.2";
// @ts-ignore deno esm
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CURSOR_KEY = "mssql_asset_history_cursor";
// Epoch sentinel for "never synced". Used as MSSQL DateTimeOffset starting point.
const EPOCH = "1900-01-01T00:00:00.000Z";

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
  batchSize: number;
  reset: boolean;
  sinceCursor: string; // ISO; rows with GREATEST(Created,Updated) > this
  sinceOldCode: string;
  sinceRefNumber: string;
  batchIndex: number;
  maxBatches: number;
  logId?: number;
}

interface CursorState {
  lastCursor: string;
  lastOldCode: string;
  lastRefNumber: string;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function quoteTableName(raw: string): string {
  const parts = raw.split(".").map((p) => p.replace(/[^a-zA-Z0-9_]/g, "")).filter(Boolean);
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
  server: string; port: number; database: string; user: string; password: string; encrypt: boolean;
}) {
  return sql.connect({
    server: c.server, port: c.port, database: c.database, user: c.user, password: c.password,
    options: { encrypt: c.encrypt, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: 30_000, requestTimeout: 120_000,
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

async function getCursor(admin: ReturnType<typeof createClient>): Promise<CursorState> {
  const { data } = await admin.from("app_settings").select("value").eq("key", CURSOR_KEY).maybeSingle();
  const v = (data?.value ?? {}) as Partial<CursorState>;
  return {
    lastCursor: v.lastCursor && typeof v.lastCursor === "string" ? v.lastCursor : EPOCH,
    lastOldCode: v.lastOldCode && typeof v.lastOldCode === "string" ? v.lastOldCode : "",
    lastRefNumber: v.lastRefNumber && typeof v.lastRefNumber === "string" ? v.lastRefNumber : "",
  };
}

async function setCursor(admin: ReturnType<typeof createClient>, state: CursorState) {
  await admin.from("app_settings").upsert(
    { key: CURSOR_KEY, value: { ...state, updatedAt: new Date().toISOString() } },
    { onConflict: "key" },
  );
}

async function runBatch(
  admin: ReturnType<typeof createClient>,
  DB_PASSWORD: string,
  SUPABASE_URL: string,
  SERVICE_KEY: string,
  opts: BatchOpts,
) {
  const { batchSize, reset, sinceCursor, sinceOldCode, sinceRefNumber, batchIndex, maxBatches, logId } = opts;
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
      .from("app_settings").select("value").eq("key", "asset_db_connection").maybeSingle();
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

    // Build incremental query:
    //   cursor = GREATEST(TRY_CAST(CreatedDate), TRY_CAST(UpdatedDate))
    //   filter: cursor > @sinceCursor AND CreatedDate >= max(12-months-ago, 2026-01-01)
    //   order : cursor ASC, then OldCode ASC (deterministic tiebreaker)
    const req = pool!.request();
    const sinceDate = toDate(sinceCursor) ?? new Date(EPOCH);
    req.input("sinceCursor", sql.DateTimeOffset, sinceDate);
    req.input("sinceOldCode", sql.NVarChar, sinceOldCode);
    req.input("sinceRefNumber", sql.NVarChar, sinceRefNumber);

    const cursorExpr = `
      CASE
        WHEN TRY_CAST([UpdatedDate] AS datetime2) IS NULL THEN TRY_CAST([CreatedDate] AS datetime2)
        WHEN TRY_CAST([CreatedDate] AS datetime2) IS NULL THEN TRY_CAST([UpdatedDate] AS datetime2)
        WHEN TRY_CAST([UpdatedDate] AS datetime2) >= TRY_CAST([CreatedDate] AS datetime2)
          THEN TRY_CAST([UpdatedDate] AS datetime2)
        ELSE TRY_CAST([CreatedDate] AS datetime2)
      END
    `;

    const q = `
      SELECT TOP ${batchSize} *,
        (${cursorExpr}) AS __cursor,
        COALESCE(CAST([OldCode] AS nvarchar(255)), '') AS __cursor_old_code,
        COALESCE(CAST([RefNumber] AS nvarchar(255)), '') AS __cursor_ref_number
      FROM ${historyTable}
      WHERE (
          (${cursorExpr}) > @sinceCursor
          OR (
            (${cursorExpr}) = @sinceCursor
            AND (
              COALESCE(CAST([OldCode] AS nvarchar(255)), '') > @sinceOldCode
              OR (
                COALESCE(CAST([OldCode] AS nvarchar(255)), '') = @sinceOldCode
                AND COALESCE(CAST([RefNumber] AS nvarchar(255)), '') > @sinceRefNumber
              )
            )
          )
        )
        AND TRY_CAST([CreatedDate] AS datetime2) >= (
          SELECT MAX(d) FROM (VALUES (DATEADD(month, -12, GETDATE())), ('2026-01-01')) AS v(d)
        )
      ORDER BY (${cursorExpr}) ASC,
        COALESCE(CAST([OldCode] AS nvarchar(255)), '') ASC,
        COALESCE(CAST([RefNumber] AS nvarchar(255)), '') ASC
    `;

    const r = await req.query(q);
    const list = (r.recordset ?? []) as Record<string, unknown>[];

    // First batch only: wipe target when full-reset requested
    if (reset && batchIndex === 0) {
      await admin.from("mssql_asset_history")
        .delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }

    const nowIso = new Date().toISOString();
    const rows = list.map((item) => ({
      ref_number:             pickStr(item, ["RefNumber"]),
      old_code:               pickStr(item, ["OldCode"]),
      project:                pickStr(item, ["Project"]),
      media_type:             pickStr(item, ["MediaType"]),
      bkk_upc:                pickStr(item, ["BKKUPC"]),
      category:               pickStr(item, ["Category"]),
      created_date:           isoOrNull(item["CreatedDate"]),
      updated_date:           isoOrNull(item["UpdatedDate"]),
      status:                 pickStr(item, ["Status"]),
      inform_position:        pickStr(item, ["InformPosition"]),
      inform_detail:          pickStr(item, ["InformDetail"]),
      problem_category:       pickStr(item, ["ProblemCategory"]),
      problem_equipment:      pickStr(item, ["ProblemEquipment"]),
      problem_detail:         pickStr(item, ["ProblemDetail"]),
      solution_category:      pickStr(item, ["SolutionCategory"]),
      solution_detail:        pickStr(item, ["SolutionDetail"]),
      response_time:          item["ResponseTime"] == null ? null : Number(item["ResponseTime"]),
      resolve_time:           item["ResolveTime"]  == null ? null : Number(item["ResolveTime"]),
      total_turnaround_time:  item["TotalTurnaroundTime"] == null ? null : Number(item["TotalTurnaroundTime"]),
      asset_status:           pickStr(item, ["AssetStatus"]),
      synced_at:              nowIso,
    }));


    // Dedupe by natural key BEFORE upsert (source can have duplicates in one batch).
    // Natural key is (ref_number, old_code) — ticket number + asset identifies a row.
    // Keep the latest occurrence (rows arrive ordered by __cursor asc, so last wins).
    const deduped = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      const key = `${r.ref_number ?? ""}|${r.old_code ?? ""}`;
      deduped.set(key, r);
    }
    const uniqueRows = Array.from(deduped.values());

    // Upsert using the natural key (ref_number, old_code)
    let upserted = 0;
    const chunk = 500;
    for (let i = 0; i < uniqueRows.length; i += chunk) {
      const slice = uniqueRows.slice(i, i + chunk);
      const { error } = await admin
        .from("mssql_asset_history")
        .upsert(slice, { onConflict: "ref_number,old_code", ignoreDuplicates: false });
      if (error) throw new Error(error.message);
      upserted += slice.length;
    }


    // Advance cursor to MAX(__cursor) from this batch
    let nextCursor = sinceCursor;
    let nextOldCode = sinceOldCode;
    let nextRefNumber = sinceRefNumber;
    if (list.length) {
      const last = list[list.length - 1]["__cursor"];
      const iso = isoOrNull(last);
      if (iso) nextCursor = iso;
      nextOldCode = String(list[list.length - 1]["__cursor_old_code"] ?? "");
      nextRefNumber = String(list[list.length - 1]["__cursor_ref_number"] ?? "");
    }

    // Persist cursor only when we made progress
    const madeProgress = nextCursor !== sinceCursor || nextOldCode !== sinceOldCode || nextRefNumber !== sinceRefNumber;
    if (madeProgress) await setCursor(admin, {
      lastCursor: nextCursor,
      lastOldCode: nextOldCode,
      lastRefNumber: nextRefNumber,
    });

    const isFull = list.length === batchSize;
    const noProgress = !madeProgress;
    const hasMore = isFull && !noProgress && batchIndex + 1 < maxBatches;

    await pool!.close(); pool = null;

    // When sync is done (no more chaining), refresh materialized views in background
    if (!hasMore) {
      // @ts-ignore EdgeRuntime
      EdgeRuntime.waitUntil(
        admin.rpc("refresh_pm_views").then(({ error }: { error: { message: string } | null }) => {
          if (error) console.error("refresh_pm_views failed:", error.message);
        }),
      );
    }

    const reason = !isFull ? "no more changes" : noProgress ? "STOPPED: cursor stuck" :
      batchIndex + 1 >= maxBatches ? "maxBatches reached" : "continuing";
    await setLog(
      "success",
      `batch #${batchIndex} upserted ${upserted} rows (since=${sinceCursor}, next=${nextCursor}) — ${hasMore ? "chaining" : reason + " · refreshing PM views"}`,
      upserted,
    );

    if (hasMore) {
      const { data: nextLog } = await admin
        .from("sync_logs")
        .insert({ source: "mssql_asset_history", status: "running",
          message: `batch #${batchIndex + 1} starting (since=${nextCursor})` })
        .select("id").single();
      const nextLogId = nextLog?.id as number | undefined;

      const url = `${SUPABASE_URL}/functions/v1/sync-asset-history`;
      const body = JSON.stringify({
        batchSize, reset: false,
        sinceCursor: nextCursor,
        sinceOldCode: nextOldCode,
        sinceRefNumber: nextRefNumber,
        batchIndex: batchIndex + 1, maxBatches, _logId: nextLogId,
      });
      // @ts-ignore EdgeRuntime
      EdgeRuntime.waitUntil(
        fetch(url, { method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body }).catch(async (err) => {
            if (nextLogId)
              await admin.from("sync_logs").update({
                status: "error",
                message: `failed to chain next batch: ${(err as Error).message}`,
                finished_at: new Date().toISOString(),
              }).eq("id", nextLogId);
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
    batchSize?: number;
    reset?: boolean;
    sinceCursor?: string;
    sinceOldCode?: string;
    sinceRefNumber?: string;
    batchIndex?: number;
    maxBatches?: number;
    _logId?: number;
  } = {};
  try { body = await req.json(); } catch { /* empty ok */ }

  const batchSize = Number.isFinite(body.batchSize)
    ? Math.max(100, Math.min(10000, Number(body.batchSize))) : 5000;
  // Default: INCREMENTAL (no wipe). Only reset=true does a full refresh.
  const reset = body.reset === true;
  const batchIndex = Number.isFinite(body.batchIndex) ? Math.max(0, Number(body.batchIndex)) : 0;
  const maxBatches = Number.isFinite(body.maxBatches)
    ? Math.max(1, Math.min(20000, Number(body.maxBatches))) : 1000;

  if (!DB_PASSWORD) {
    return jsonResponse({ ok: false, error: "MODERN_CORP_DB_PASSWORD secret not set" }, 500);
  }

  // Determine cursor:
  //   - If chained call, trust body.sinceCursor
  //   - If reset=true on first call, force EPOCH and clear persisted cursor
  //   - Otherwise, read persisted cursor
  let cursorState: CursorState;
  if (typeof body.sinceCursor === "string" && body.sinceCursor) {
    cursorState = {
      lastCursor: body.sinceCursor,
      lastOldCode: typeof body.sinceOldCode === "string" ? body.sinceOldCode : "",
      lastRefNumber: typeof body.sinceRefNumber === "string" ? body.sinceRefNumber : "",
    };
  } else if (reset) {
    cursorState = { lastCursor: EPOCH, lastOldCode: "", lastRefNumber: "" };
    await setCursor(admin, cursorState);
  } else {
    cursorState = await getCursor(admin);
  }

  let logId = body._logId;
  if (!logId) {
    const { data: logRow } = await admin
      .from("sync_logs")
      .insert({
        source: "mssql_asset_history",
        status: "running",
        message: `batch #${batchIndex} starting (mode=${reset ? "FULL RESET" : "incremental"}, since=${cursorState.lastCursor}, oldCode=${cursorState.lastOldCode}, ref=${cursorState.lastRefNumber})`,
      }).select("id").single();
    logId = logRow?.id as number | undefined;
  }

  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(
    runBatch(admin, DB_PASSWORD, SUPABASE_URL, SERVICE_KEY, {
      batchSize, reset,
      sinceCursor: cursorState.lastCursor,
      sinceOldCode: cursorState.lastOldCode,
      sinceRefNumber: cursorState.lastRefNumber,
      batchIndex, maxBatches, logId,
    }),
  );

  return jsonResponse({
    ok: true, queued: true, logId, batchIndex,
    mode: reset ? "full-reset" : "incremental",
    sinceCursor: cursorState.lastCursor,
    sinceOldCode: cursorState.lastOldCode,
    sinceRefNumber: cursorState.lastRefNumber,
    batchSize,
    message: "batch queued; subsequent batches will auto-chain. Watch sync_logs.",
  });
});
