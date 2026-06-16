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
    const raw = await fetchPlanB(url);
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

    for (const item of list as Record<string, unknown>[]) {
      const refNumber = String(
        item.refNumber ?? item.RefNumber ?? item.ref_number ??
        item.ticketCode ?? item.TicketCode ?? item.ticket_code ?? item.id ?? "",
      );
      if (!refNumber || seen.has(refNumber)) continue;
      seen.add(refNumber);

      const rawOpenedAt = (item.openedAt ?? item.OpenedAt ?? item.createdAt ?? item.createdDate ?? item.CreatedDate ?? null) as string | null;
      const totalTimeHours = typeof item.totalTime === "number" ? item.totalTime : Number(item.totalTime ?? NaN);
      // For "Working On" tickets the upstream API often omits openedAt but still
      // exposes totalTime (hours since open). Derive opened_at so the UI shows the
      // real open date instead of "today".
      const openedAt = rawOpenedAt
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

export async function runAssetHistorySync(oldCode: string) {
  const id = await logStart("asset");
  try {
    const tmpl = (await readSetting("asset_api_url")) as string | undefined;
    if (!tmpl) throw new Error("ยังไม่ได้ตั้งค่า asset_api_url");
    const url = tmpl.replace("{id}", encodeURIComponent(oldCode));
    const raw = (await fetchPlanB(url)) as Record<string, unknown>;

    const { data: asset } = await supabaseAdmin
      .from("assets")
      .upsert({ old_code: oldCode }, { onConflict: "old_code" })
      .select("id")
      .single();

    // API shape: { pm: [...], monitoring: [...], claim: [...] }
    // Items: { createdDate, status, ... } — no ticket code, so synthesize stable key.
    const groups: Array<{ key: string; type: "PM" | "Monitor" | "Claim" }> = [
      { key: "pm", type: "PM" },
      { key: "monitoring", type: "Monitor" },
      { key: "claim", type: "Claim" },
    ];

    // Clear previous synthetic rows for this asset to avoid stale duplicates
    await supabaseAdmin.from("asset_history").delete().eq("asset_old_code", oldCode);

    type HistoryRow = {
      asset_id: string | null;
      asset_old_code: string;
      ticket_code: string;
      type: string;
      title: string | null;
      status: string | null;
      opened_at: string | null;
      closed_at: string | null;
      payload: never;
    };
    const rows: HistoryRow[] = [];
    for (const g of groups) {
      const list = Array.isArray(raw?.[g.key]) ? (raw[g.key] as Record<string, unknown>[]) : [];
      list.forEach((item, idx) => {
        const createdDate = (item.createdDate ?? item.CreatedDate ?? null) as string | null;
        const updatedDate = (item.updatedDate ?? item.UpdatedDate ?? null) as string | null;
        const status = (item.status ?? item.Status ?? null) as string | null;
        const solutionDetail = (item.solutionDetail ?? null) as string | null;
        const solutionCategory = (item.solutionCategory ?? null) as string | null;
        const title =
          g.type === "Claim"
            ? solutionDetail || solutionCategory || "Claim"
            : g.type === "PM"
              ? "Preventive Maintenance"
              : "Monitoring Check";
        const syntheticTicket = `${g.type}-${oldCode}-${createdDate ?? "na"}-${idx}`;
        rows.push({
          asset_id: asset?.id ?? null,
          asset_old_code: oldCode,
          ticket_code: syntheticTicket,
          type: g.type,
          title,
          status,
          opened_at: createdDate,
          // Store the ticket's latest update timestamp so UI shows "อัพเดทล่าสุด"
          // and computes duration from open → last update.
          closed_at:
            updatedDate ??
            (status && /finish|approved|closed|done/i.test(status) ? createdDate : null),
          payload: item as never,
        });
      });
    }

    let n = 0;
    if (rows.length) {
      const { error } = await supabaseAdmin
        .from("asset_history")
        .upsert(rows, { onConflict: "ticket_code,type" });
      if (error) throw error;
      n = rows.length;
    }
    await supabaseAdmin
      .from("assets")
      .update({ last_history_synced_at: new Date().toISOString() })
      .eq("old_code", oldCode);
    await logFinish(id, "success", `synced ${n} history rows for ${oldCode}`, n);
    return { ok: true, rows: n };
  } catch (e) {
    await logFinish(id, "error", (e as Error).message, 0);
    throw e;
  }
}

// Batch sync — process oldest-synced assets first, single log row per batch.
export async function runAssetHistorySyncBatch(limit = 100): Promise<{ ok: boolean; rows: number; processed: number; failed: number; error?: string }> {
  const id = await logStart("asset-history-batch");
  try {
    const tmplRaw = (await readSetting("asset_history_endpoint")) as string | undefined;
    if (!tmplRaw) throw new Error("ยังไม่ได้ตั้งค่า asset_history_endpoint");
    const tmpl: string = tmplRaw;

    const { data: assets, error: aErr } = await supabaseAdmin
      .from("assets")
      .select("id, old_code, last_history_synced_at")
      .order("last_history_synced_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (aErr) throw aErr;

    let totalRows = 0;
    let processed = 0;
    let failed = 0;
    const errorSamples: string[] = [];

    type HistoryRow = {
      asset_id: string | null;
      asset_old_code: string;
      ticket_code: string;
      type: string;
      title: string | null;
      status: string | null;
      opened_at: string | null;
      closed_at: string | null;
      payload: never;
    };

    async function syncOne(a: { id: string | null; old_code: string }) {
      const oldCode = a.old_code;
      if (!oldCode) return;
      try {
        const url = tmpl.replace("{id}", encodeURIComponent(oldCode));
        const raw = (await fetchPlanB(url)) as Record<string, unknown>;
        const groups: Array<{ key: string; type: "PM" | "Monitor" | "Claim" }> = [
          { key: "pm", type: "PM" },
          { key: "monitoring", type: "Monitor" },
          { key: "claim", type: "Claim" },
        ];
        await supabaseAdmin.from("asset_history").delete().eq("asset_old_code", oldCode);
        const rows: HistoryRow[] = [];
        for (const g of groups) {
          const list = Array.isArray(raw?.[g.key]) ? (raw[g.key] as Record<string, unknown>[]) : [];
          list.forEach((item, idx) => {
            const createdDate = (item.createdDate ?? item.CreatedDate ?? null) as string | null;
            const updatedDate = (item.updatedDate ?? item.UpdatedDate ?? null) as string | null;
            const status = (item.status ?? item.Status ?? null) as string | null;
            const solutionDetail = (item.solutionDetail ?? null) as string | null;
            const solutionCategory = (item.solutionCategory ?? null) as string | null;
            const title =
              g.type === "Claim"
                ? solutionDetail || solutionCategory || "Claim"
                : g.type === "PM"
                  ? "Preventive Maintenance"
                  : "Monitoring Check";
            rows.push({
              asset_id: a.id ?? null,
              asset_old_code: oldCode,
              ticket_code: `${g.type}-${oldCode}-${createdDate ?? "na"}-${idx}`,
              type: g.type,
              title,
              status,
              opened_at: createdDate,
              closed_at: updatedDate ?? (status && /finish|approved|closed|done/i.test(status) ? createdDate : null),
              payload: item as never,
            });
          });
        }
        if (rows.length) {
          const { error } = await supabaseAdmin
            .from("asset_history")
            .upsert(rows, { onConflict: "ticket_code,type" });
          if (error) throw error;
          totalRows += rows.length;
        }
        await supabaseAdmin
          .from("assets")
          .update({ last_history_synced_at: new Date().toISOString() })
          .eq("old_code", oldCode);
        processed++;
      } catch (e) {
        failed++;
        const msg = (e as Error).message;
        if (errorSamples.length < 3) errorSamples.push(`${oldCode}: ${msg}`);
        console.warn(`asset-history sync failed for ${oldCode}:`, msg);
      }
    }

    // Run with bounded concurrency to stay inside the Worker time budget.
    const queue = [...(assets ?? [])] as { id: string | null; old_code: string }[];
    const concurrency = 4;
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const next = queue.shift();
        if (!next) break;
        await syncOne(next);
      }
    });
    await Promise.all(workers);

    const errorTail = errorSamples.length ? ` | errors: ${errorSamples.join(" ; ")}` : "";
    await logFinish(
      id,
      failed === 0 ? "success" : "warning",
      `batch: ${processed} assets synced, ${failed} failed, ${totalRows} history rows${errorTail}`,
      totalRows,
    );
    return { ok: true, rows: totalRows, processed, failed };
  } catch (e) {
    await logFinish(id, "error", (e as Error).message, 0);
    return { ok: false, rows: 0, processed: 0, failed: 0, error: (e as Error).message };
  }
}
