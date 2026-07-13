// Supabase Edge Function (Deno) — connects directly to MS SQL Server via TDS
// Avoids the Cloudflare Worker limitation (no raw TCP). Called by:
//   1) src/lib/sync.server.ts -> supabaseAdmin.functions.invoke("sync-assets")
//   2) pg_cron via net.http_post (scheduled days at 04:00)

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
  table?: string;
  pmScheduleTable?: string;
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
    .map((part) => part.replace(/[^a-zA-Z0-9_]/g, ""))
    .filter(Boolean);
  if (!parts.length) throw new Error("invalid table name");
  return parts.map((part) => `[${part}]`).join(".");
}

function toUserFacingError(message: string, host: string) {
  if (/Failed to connect|timeout|ETIMEOUT/i.test(message)) {
    return `เชื่อมต่อ Modern Corporate Server ไม่สำเร็จ: ${host} เปิดพอร์ต 1433 ให้ Lovable Cloud เข้าถึงไม่ได้หรือถูก firewall บล็อก`;
  }
  if (/Login failed/i.test(message)) return "เข้าสู่ระบบ Modern Corporate Server ไม่สำเร็จ: ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
  if (/Cannot open database|database/i.test(message)) return "เชื่อมต่อฐานข้อมูลไม่สำเร็จ: ตรวจสอบชื่อ Database และสิทธิ์ของผู้ใช้";
  return message;
}

function parseHostPort(raw: string): { server: string; port: number } {
  const [server, portStr] = raw.split(":");
  return { server: server.trim(), port: portStr ? Number(portStr.trim()) : 1433 };
}

async function connectMssql(config: {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
}) {
  return sql.connect({
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    connectionTimeout: 30_000,
    requestTimeout: 120_000,
  });
}

function pickStr(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (v != null && String(v).trim() !== "") return String(v);
  }
  return null;
}
function pickNum(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (v != null && v !== "" && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}
function parseLatLng(raw: string | null): [number, number] | null {
  if (!raw) return null;
  const m = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

// @ts-ignore Deno global
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // @ts-ignore Deno global
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  // @ts-ignore Deno global
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // @ts-ignore Deno global
  const DB_PASSWORD = Deno.env.get("MODERN_CORP_DB_PASSWORD");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // start log row
  const { data: logRow } = await admin
    .from("sync_logs")
    .insert({ source: "asset", status: "running", message: "started (edge:sync-assets)" })
    .select("id")
    .single();
  const logId = logRow?.id as number | undefined;

  const finish = async (status: "success" | "error" | "warning", message: string, rows: number) => {
    if (logId)
      await admin
        .from("sync_logs")
        .update({ status, message, rows_affected: rows, finished_at: new Date().toISOString() })
        .eq("id", logId);
  };

  let pool: { close: () => Promise<void> } | null = null;

  let targetHost = "magicticket.magicsigncloud.com:1433";

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
    const table = quoteTableName(conn.table ?? "Asset");
    // pmScheduleTable is synced via the dedicated `sync-pm-schedules` edge function.
    // historyTable is now synced via the dedicated `sync-asset-history` edge function.

    const parsed = parseHostPort(host);
    const server = parsed.server;
    const port = conn.port ? Number(conn.port) : parsed.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid MSSQL port");
    targetHost = `${server}:${port}`;

    const encrypt = conn.encrypt ?? false;
    try {
      pool = await connectMssql({ server, port, database, user, password: DB_PASSWORD, encrypt });
    } catch (firstError) {
      if (encrypt) throw firstError;
      console.warn("sync-assets retrying MSSQL connection with encrypt=true", (firstError as Error).message);
      pool = await connectMssql({ server, port, database, user, password: DB_PASSWORD, encrypt: true });
    }

    const result = await pool.request().query(`SELECT * FROM ${table}`);
    const list = (result.recordset ?? []) as Record<string, unknown>[];

    let n = 0;
    const batchSize = 200;
    for (let i = 0; i < list.length; i += batchSize) {
      const rowsByCode = new Map<string, Record<string, unknown>>();
      for (const item of list.slice(i, i + batchSize)) {
        const oldCode = pickStr(item, ["oldCode", "OldCode", "old_code", "assetCode", "AssetCode", "code", "Code"]);
        if (!oldCode) continue;
        rowsByCode.set(oldCode, {
          old_code: oldCode,
          name: pickStr(item, ["name", "Name", "assetName", "AssetName"]),
          department: pickStr(item, ["department", "Department"]),
          area: pickStr(item, ["area", "Area", "location", "Location"]),
          status: pickStr(item, ["status", "Status"]),
          latitude: pickNum(item, ["latitude", "Latitude", "lat", "Lat"]) ?? parseLatLng(pickStr(item, ["LatitudeLongitude", "latitudeLongitude"]))?.[0] ?? null,
          longitude: pickNum(item, ["longitude", "Longitude", "lng", "Lng"]) ?? parseLatLng(pickStr(item, ["LatitudeLongitude", "latitudeLongitude"]))?.[1] ?? null,
          installed_at: pickStr(item, ["installedAt", "InstalledAt", "installed_at", "InstallDate"]),
          // Phase A2: promote key payload fields to real columns for fast filtering.
          bkkupc: pickStr(item, ["BKKUPC", "bkkupc", "BkkUpc"]),
          district: pickStr(item, ["District", "district"]),
          territory: pickStr(item, ["Territory", "territory"]),
          location: pickStr(item, ["Location", "location"]),
          media_type: pickStr(item, ["MediaType", "mediaType", "media_type"]),
          payload: item,
          updated_at: new Date().toISOString(),
        });
      }
      const rows = Array.from(rowsByCode.values());

      if (rows.length) {
        const { error } = await admin.from("assets").upsert(rows, { onConflict: "old_code" });
        if (error) throw new Error(error.message);
        n += rows.length;
      }
    }

    // NOTE: Asset_PM_Schedule sync moved to a dedicated edge function `sync-pm-schedules`
    // to keep this function's CPU budget for the larger Asset table.
    const pmCount = 0;


    // NOTE: AssetHistory sync moved to a dedicated edge function `sync-asset-history`
    // because the table is large enough to exceed the Worker CPU-time budget when
    // combined with Asset + Asset_PM_Schedule in a single invocation.
    const histCount = 0;

    await pool.close();
    pool = null;
    await finish(
      "success",
      `synced ${n} assets + ${pmCount} PM schedules via MSSQL`,
      n + pmCount,
    );

    return jsonResponse({ ok: true, rows: n, pmRows: pmCount, historyRows: histCount });

  } catch (e) {
    const msg = (e as Error).message;
    const userMessage = toUserFacingError(msg, targetHost);
    console.error("sync-assets failed", msg);
    if (pool) await pool.close().catch(() => null);
    await finish("error", userMessage, 0);
    return jsonResponse({ ok: false, rows: 0, error: userMessage, technicalError: msg, fallback: true });
  }
});
