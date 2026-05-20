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

    const parsed = parseHostPort(host);
    const server = parsed.server;
    const port = conn.port ? Number(conn.port) : parsed.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid MSSQL port");
    targetHost = `${server}:${port}`;

    pool = await sql.connect({
      server,
      port,
      database,
      user,
      password: DB_PASSWORD,
      options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
      connectionTimeout: 10_000,
      requestTimeout: 60_000,
    });

    const result = await pool.request().query(`SELECT * FROM ${table}`);
    const list = (result.recordset ?? []) as Record<string, unknown>[];

    let n = 0;
    const batchSize = 200;
    for (let i = 0; i < list.length; i += batchSize) {
      const rows = list.slice(i, i + batchSize).map((item) => {
        const oldCode =
          pickStr(item, ["oldCode", "OldCode", "old_code", "assetCode", "AssetCode", "code", "Code"]) ?? "";
        return {
          old_code: oldCode,
          name: pickStr(item, ["name", "Name", "assetName", "AssetName"]),
          department: pickStr(item, ["department", "Department"]),
          area: pickStr(item, ["area", "Area", "location", "Location"]),
          status: pickStr(item, ["status", "Status"]),
          latitude: pickNum(item, ["latitude", "Latitude", "lat", "Lat"]),
          longitude: pickNum(item, ["longitude", "Longitude", "lng", "Lng"]),
          installed_at: pickStr(item, ["installedAt", "InstalledAt", "installed_at", "InstallDate"]),
          payload: item,
          updated_at: new Date().toISOString(),
        };
      }).filter((r) => r.old_code);

      if (rows.length) {
        const { error } = await admin.from("assets").upsert(rows, { onConflict: "old_code" });
        if (error) throw new Error(error.message);
        n += rows.length;
      }
    }

    await pool.close();
    pool = null;
    await finish("success", `synced ${n} assets via MSSQL`, n);

    return jsonResponse({ ok: true, rows: n });
  } catch (e) {
    const msg = (e as Error).message;
    const userMessage = toUserFacingError(msg, targetHost);
    console.error("sync-assets failed", msg);
    if (pool) await pool.close().catch(() => null);
    await finish("error", userMessage, 0);
    return jsonResponse({ ok: false, rows: 0, error: userMessage, technicalError: msg, fallback: true });
  }
});
