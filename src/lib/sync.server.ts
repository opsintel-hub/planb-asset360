import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function readSetting(key: string): Promise<unknown> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value;
}

async function logStart(source: string) {
  const { data } = await supabaseAdmin
    .from("sync_logs")
    .insert({ source, status: "running", message: "started" })
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

async function fetchPlanB(url: string, timeoutMs = 12000): Promise<unknown> {
  const apiKey = process.env.PLANB_API_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } : { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error(`upstream timeout after ${timeoutMs}ms: ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function runAssetListSync() {
  // Direct MSSQL connection is not possible from the Cloudflare Worker runtime
  // (no TDS / raw TCP). Delegate to the Supabase Edge Function `sync-assets`
  // which runs on Deno and uses `npm:mssql` to connect directly.
  const { data, error } = await supabaseAdmin.functions.invoke("sync-assets", {
    body: {},
  });
  if (error) return { ok: false, rows: 0, error: `sync-assets edge function failed: ${error.message}` };
  const result = data as { ok?: boolean; rows?: number; error?: string; fallback?: boolean } | null;
  if (!result?.ok) return { ok: false, rows: result?.rows ?? 0, error: result?.error ?? "sync-assets returned no result" };
  return { ok: true, rows: result.rows ?? 0 };
}


export async function runClaimSync() {
  const id = await logStart("claim");
  try {
    const url = (await readSetting("claim_api_url")) as string | undefined;
    if (!url) throw new Error("ยังไม่ได้ตั้งค่า claim_api_url");
    const raw = await fetchPlanB(url, 25000);
    const list = Array.isArray(raw) ? raw : ((raw as { data?: unknown[] })?.data ?? []);

    // Build snapshot rows for claim_tickets (1 ticket = 1 row) and append rows for claims (audit log)
    const syncedAt = new Date().toISOString();
    type SnapshotRow = {
      ref_number: string;
      asset_old_code: string | null;
      location: string | null;
      informed_detail: string | null;
      title: string | null;
      status: string | null;
      severity: string | null;
      opened_at: string | null;
      age_hours: number | null;
      sla_status: string | null;
      payload: never;
      synced_at: string;
    };
    type AuditRow = {
      ticket_code: string;
      asset_old_code: string | null;
      title: string | null;
      opened_at: string | null;
      age_hours: number | null;
      sla_status: string | null;
      severity: string | null;
      payload: never;
      synced_at: string;
    };
    const snapshotRows: SnapshotRow[] = [];
    const auditRows: AuditRow[] = [];
    const seen = new Set<string>();

    // Preload existing opened_at so we don't "drift" the open date each sync.
    // Upstream Claim API doesn't send a real openedAt — only `totalTime`
    // (hours since open). We derive opened_at = now − totalTime on FIRST sight,
    // then preserve that value on subsequent syncs.
    const { data: existingTickets } = await supabaseAdmin
      .from("claim_tickets")
      .select("ref_number, opened_at");
    const existingOpenedAt = new Map<string, string | null>(
      (existingTickets ?? []).map((r) => [r.ref_number as string, r.opened_at as string | null]),
    );

    for (const item of list as Record<string, unknown>[]) {
      const refNumber = String(
        item.refNumber ?? item.RefNumber ?? item.ref_number ??
        item.ticketCode ?? item.TicketCode ?? item.ticket_code ?? item.id ?? "",
      );
      if (!refNumber || seen.has(refNumber)) continue;
      seen.add(refNumber);

      const rawOpenedAt = (item.openedAt ?? item.OpenedAt ?? item.createdAt ?? item.createdDate ?? item.CreatedDate ?? null) as string | null;
      const totalTimeHours = typeof item.totalTime === "number" ? item.totalTime : Number(item.totalTime ?? NaN);
      // Preserve first-seen opened_at; only compute when we've never seen this ticket.
      const prevOpenedAt = existingOpenedAt.get(refNumber) ?? null;
      const openedAt = prevOpenedAt
        ?? rawOpenedAt
        ?? (Number.isFinite(totalTimeHours)
              ? new Date(Date.now() - totalTimeHours * 3_600_000).toISOString()
              : null);
      const ageHours = openedAt
        ? (Date.now() - new Date(openedAt).getTime()) / 3_600_000
        : Number.isFinite(totalTimeHours) ? totalTimeHours : null;
      const sla = ageHours == null ? null : ageHours < 24 ? "ontrack" : ageHours < 72 ? "atrisk" : "breached";
      const oldCode = (item.oldCode ?? item.assetCode ?? item.AssetCode ?? null) as string | null;
      const location = (item.location ?? item.Location ?? null) as string | null;
      const informedDetail = (item.informDetail ?? item.informedDetail ?? item.InformedDetail ?? null) as string | null;
      const title = informedDetail ?? (item.title ?? item.subject ?? item.description ?? location ?? null) as string | null;
      const severity = (item.severity ?? item.status ?? null) as string | null;
      const status = (item.status ?? item.Status ?? null) as string | null;

      snapshotRows.push({
        ref_number: refNumber,
        asset_old_code: oldCode,
        location,
        informed_detail: informedDetail,
        title,
        status,
        severity,
        opened_at: openedAt,
        age_hours: ageHours,
        sla_status: sla,
        payload: item as never,
        synced_at: syncedAt,
      });
      auditRows.push({
        ticket_code: refNumber,
        asset_old_code: oldCode,
        title,
        opened_at: openedAt,
        age_hours: ageHours,
        sla_status: sla,
        severity,
        payload: item as never,
        synced_at: syncedAt,
      });
    }

    // Snapshot: upsert all current tickets, then delete anything not in the current API response.
    if (snapshotRows.length) {
      const { error: upErr } = await supabaseAdmin
        .from("claim_tickets")
        .upsert(snapshotRows, { onConflict: "ref_number" });
      if (upErr) throw upErr;
    }
    const currentRefs = Array.from(seen);
    if (currentRefs.length) {
      // Delete stale rows by computing the diff against existing snapshot.
      const { data: existing } = await supabaseAdmin
        .from("claim_tickets")
        .select("ref_number");
      const currentSet = new Set(currentRefs);
      const stale = (existing ?? [])
        .map((r) => r.ref_number as string)
        .filter((r) => !currentSet.has(r));
      if (stale.length) {
        const { error: delErr } = await supabaseAdmin
          .from("claim_tickets")
          .delete()
          .in("ref_number", stale);
        if (delErr) throw delErr;
      }
    } else {
      // API returned zero tickets — clear snapshot entirely.
      await supabaseAdmin.from("claim_tickets").delete().neq("ref_number", "");
    }

    // Audit log: append every observation to `claims` (history/audit trail).
    if (auditRows.length) {
      const { error: auErr } = await supabaseAdmin.from("claims").insert(auditRows);
      if (auErr) throw auErr;
    }

    const n = snapshotRows.length;
    await logFinish(id, "success", `snapshot ${n} claim tickets, +${auditRows.length} audit rows`, n);
    return { ok: true, rows: n };
  } catch (e) {
    await logFinish(id, "error", (e as Error).message, 0);
    throw e;
  }
}

// NOTE: The legacy Plan B Airtable / HTTP `asset_history` sync (runAssetHistorySync
// and runAssetHistorySyncBatch) was removed when we consolidated all asset history
// to MSSQL `mssql_asset_history`. The MSSQL bulk sync is handled by the Supabase
// edge function `sync-asset-history` (see supabase/functions/sync-asset-history).

export async function runAssetHistorySyncBatch(_limit = 100): Promise<{ ok: boolean; rows: number; processed: number; failed: number; error?: string }> {
  return {
    ok: false,
    rows: 0,
    processed: 0,
    failed: 0,
    error:
      "Plan B asset_history sync was removed. ใช้การ Sync จาก MSSQL (Settings → Modern Corporate Server → AssetHistory) เป็นแหล่งเดียวแทน",
  };
}

