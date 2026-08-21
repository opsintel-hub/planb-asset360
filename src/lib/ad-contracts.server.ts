import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CrmDbConn = {
  host?: string;
  port?: number | string;
  database?: string;
  username?: string;
  view?: string;
};

export type AdContractRow = {
  asset_old_code: string | null;
  equipment_id: string | null;
  product_name: string | null;
  ad_contract: string | null;
  status: string;
  start_date_contract: string | null;
  end_date_contract: string | null;
  favor_start_date_contract: string | null;
  favor_end_date_contract: string | null;
  payload: Record<string, unknown>;
  synced_at: string;
  last_seen_at: string;
};

function pickStr(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s === "" || s.toUpperCase() === "NULL") continue;
    return s;
  }
  return null;
}

function pickDate(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (v == null || v === "") continue;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    if (!s || s.toUpperCase() === "NULL" || s.startsWith("0000")) continue;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

/** Map one upstream `view_productstatus` row into an `ad_contracts` row. */
export function mapCrmRow(item: Record<string, unknown>, syncedAt: string): AdContractRow | null {
  const oldCode = pickStr(item, ["old_code", "oldCode", "OldCode", "asset_old_code", "AssetCode", "assetCode"]);
  const productName = pickStr(item, ["product_name", "productName", "ProductName", "product"]);
  if (!oldCode && !productName) return null;
  return {
    asset_old_code: oldCode,
    equipment_id: pickStr(item, ["equipment_id", "equipmentId", "EquipmentId", "EquipmentID"]),
    product_name: productName,
    ad_contract: pickStr(item, ["ad_contract", "adContract", "AdContract", "contract"]),
    status: (pickStr(item, ["status", "Status"]) ?? "current").toLowerCase(),
    start_date_contract: pickDate(item, ["start_date_contract", "startDateContract"]),
    end_date_contract: pickDate(item, ["end_date_contract", "endDateContract"]),
    favor_start_date_contract: pickDate(item, ["favor_start_date_contract", "favorStartDateContract"]),
    favor_end_date_contract: pickDate(item, ["favor_end_date_contract", "favorEndDateContract"]),
    payload: item,
    synced_at: syncedAt,
    last_seen_at: syncedAt,
  };
}

function naturalKey(r: AdContractRow) {
  return [r.ad_contract ?? "", r.asset_old_code ?? "", r.product_name ?? "", r.start_date_contract ?? ""].join("|");
}

function friendlyError(message: string, host: string) {
  if (/ETIMEDOUT|ETIMEOUT|timeout|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|getaddrinfo|not implemented/i.test(message)) {
    return `เชื่อมต่อ CRM Server ไม่สำเร็จ: ${host} — พอร์ต MySQL ยังไม่เปิดให้เข้าถึงจากภายนอก (ถูก firewall กรอง). ให้ทีม IT เปิด inbound TCP ที่พอร์ตดังกล่าวสำหรับ Cloudflare IP ranges (https://www.cloudflare.com/ips/) และอนุญาต MySQL user ให้ล็อกอินจาก host ภายนอก ('useroperation'@'%'). ระหว่างนี้ใช้ Push Endpoint ส่งข้อมูลเข้ามาได้`;
  }
  if (/Access denied|authentication/i.test(message)) return "เข้าสู่ระบบ CRM ไม่สำเร็จ: ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
  if (/Unknown database/i.test(message)) return "ไม่พบฐานข้อมูล: ตรวจสอบชื่อ database";
  if (/doesn't exist|Unknown table|Table .* doesn/i.test(message)) return "ไม่พบ view: ตรวจสอบชื่อ view (เช่น view_productstatus)";
  return message;
}

async function logStart(source: string, message: string) {
  const { data } = await supabaseAdmin
    .from("sync_logs")
    .insert({ source, status: "running", message })
    .select("id")
    .single();
  return data?.id as number | undefined;
}

async function logFinish(id: number | undefined, status: "success" | "warning" | "error", message: string, rows: number) {
  if (!id) return;
  await supabaseAdmin
    .from("sync_logs")
    .update({ status, message, rows_affected: rows, finished_at: new Date().toISOString() })
    .eq("id", id);
}

export async function readCrmConn(): Promise<Required<CrmDbConn>> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "crm_db_connection")
    .maybeSingle();
  const conn = (data?.value ?? {}) as CrmDbConn;
  return {
    host: (conn.host ?? "117.121.218.84").trim(),
    port: conn.port ? Number(conn.port) : 3306,
    database: (conn.database ?? "sugarcrm_prod").trim(),
    username: (conn.username ?? "useroperation").trim(),
    view: (conn.view ?? "view_productstatus").trim(),
  };
}

/**
 * CRM `old_code` only matches ~13% of our assets, but `equipment_id` matches a
 * much larger share. Fill in / correct `asset_old_code` from the asset whose
 * payload EquipmentID equals the CRM equipment_id so every menu can join on
 * `asset_old_code` as designed.
 */
async function resolveAssetCodes(rows: AdContractRow[]): Promise<void> {
  const byEquipment = new Map<string, string>();
  const knownCodes = new Set<string>();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabaseAdmin
      .from("assets")
      .select("old_code, payload")
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const list = (data ?? []) as Array<{ old_code: string | null; payload: Record<string, unknown> | null }>;
    for (const a of list) {
      if (!a.old_code) continue;
      knownCodes.add(a.old_code);
      const eq = a.payload?.["EquipmentID"];
      if (typeof eq === "string" && eq.trim()) byEquipment.set(eq.trim(), a.old_code);
    }
    if (list.length < page) break;
  }

  for (const r of rows) {
    const matched = r.asset_old_code && knownCodes.has(r.asset_old_code);
    if (matched) continue;
    const viaEq = r.equipment_id ? byEquipment.get(r.equipment_id.trim()) : undefined;
    if (viaEq) r.asset_old_code = viaEq;
  }
}

/** Upsert a batch of mapped rows, then archive rows that vanished upstream. */
export async function persistAdContracts(
  rows: AdContractRow[],
  syncedAt: string,
  archiveMissing: boolean,
): Promise<number> {
  await resolveAssetCodes(rows);

  const byKey = new Map<string, AdContractRow>();
  for (const r of rows) byKey.set(naturalKey(r), r);
  const unique = Array.from(byKey.values());

  let written = 0;
  const batch = 500;
  for (let i = 0; i < unique.length; i += batch) {
    const slice = unique.slice(i, i + batch);
    const { error } = await supabaseAdmin
      .from("ad_contracts")
      .upsert(slice, { onConflict: "ad_contract,asset_old_code,product_name,start_date_contract" });
    if (error) throw new Error(error.message);
    written += slice.length;
  }

  if (archiveMissing) {
    const { error } = await supabaseAdmin
      .from("ad_contracts")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("status", "current")
      .lt("last_seen_at", syncedAt);
    if (error) throw new Error(error.message);
  }
  return written;
}

/**
 * Pull straight from the CRM MySQL view. Only works when the CRM host is
 * reachable from the internet — an internal 172.x address will time out.
 */
export async function pullAdContractsFromCrm(): Promise<{ ok: boolean; rows: number; error?: string }> {
  const logId = await logStart("ad_contract", "started (pull:crm-mysql)");
  const conn = await readCrmConn();
  const host = `${conn.host}:${conn.port}`;
  let connection: { query: (sql: string) => Promise<unknown>; end: () => Promise<void> } | null = null;
  try {
    const password = process.env["CRM_DB_PASSWORD"];
    if (!password) throw new Error("CRM_DB_PASSWORD secret not set");
    const view = conn.view.replace(/[^a-zA-Z0-9_]/g, "");
    if (!view) throw new Error("invalid view name");

    const mysql = await import("mysql2/promise");
    connection = (await mysql.createConnection({
      host: conn.host,
      port: Number(conn.port),
      user: conn.username,
      password,
      database: conn.database,
      connectTimeout: 20_000,
      dateStrings: true,
    })) as unknown as { query: (sql: string) => Promise<unknown>; end: () => Promise<void> };

    const result = (await connection.query(`SELECT * FROM \`${view}\``)) as [Record<string, unknown>[], unknown];
    const list = (Array.isArray(result) ? result[0] : []) as Record<string, unknown>[];

    const syncedAt = new Date().toISOString();
    const mapped = list.map((r) => mapCrmRow(r, syncedAt)).filter((r): r is AdContractRow => r !== null);
    const written = await persistAdContracts(mapped, syncedAt, true);

    await connection.end();
    connection = null;
    await logFinish(logId, "success", `synced ${written} ad contract rows from CRM (${conn.view})`, written);
    return { ok: true, rows: written };
  } catch (e) {
    const msg = friendlyError((e as Error).message, host);
    if (connection) await connection.end().catch(() => null);
    await logFinish(logId, "error", msg, 0);
    return { ok: false, rows: 0, error: msg };
  }
}

/** Accept rows pushed in by the CRM/IT team (fallback when the port stays closed). */
export async function ingestPushedAdContracts(
  items: Record<string, unknown>[],
  archiveMissing: boolean,
): Promise<{ ok: boolean; rows: number; error?: string }> {
  const logId = await logStart("ad_contract", "started (push:it-endpoint)");
  try {
    const syncedAt = new Date().toISOString();
    const mapped = items.map((r) => mapCrmRow(r, syncedAt)).filter((r): r is AdContractRow => r !== null);
    const written = await persistAdContracts(mapped, syncedAt, archiveMissing);
    await logFinish(logId, "success", `ingested ${written} ad contract rows (push)`, written);
    return { ok: true, rows: written };
  } catch (e) {
    const msg = (e as Error).message;
    await logFinish(logId, "error", msg, 0);
    return { ok: false, rows: 0, error: msg };
  }
}
